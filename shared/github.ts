import type { PublishFile, PublishResult } from "./types.ts";

const API = "https://api.github.com";

export class GitHubError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

async function gh<T>(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "write-editor",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let message = `GitHub ${res.status}`;
    try {
      const parsed = JSON.parse(detail) as { message?: string };
      if (parsed.message) {
        message = parsed.message;
      }
    } catch {
      if (detail) {
        message = detail.slice(0, 200);
      }
    }
    if (res.status === 401 || res.status === 403) {
      message += " — check that the token has Contents: Read & write on this repository.";
    }
    throw new GitHubError(message, res.status);
  }

  return (await res.json()) as T;
}

function encodeRef(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

export async function getDefaultBranch(token: string, repo: string): Promise<string> {
  const info = await gh<{ default_branch: string }>(token, `/repos/${repo}`);
  return info.default_branch;
}

export async function listDirectory(
  token: string,
  repo: string,
  branch: string,
  dir: string,
): Promise<{ name: string; path: string; size: number }[]> {
  try {
    const entries = await gh<{ name: string; path: string; size: number; type: string }[]>(
      token,
      `/repos/${repo}/contents/${encodeURIComponent(dir).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`,
    );
    return entries.filter((e) => e.type === "file").map(({ name, path, size }) => ({ name, path, size }));
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) {
      return [];
    }
    throw error;
  }
}

export async function tokenLogin(token: string): Promise<string | null> {
  try {
    const user = await gh<{ login: string }>(token, "/user");
    return user.login ?? null;
  } catch {
    return null;
  }
}

export async function branchExists(token: string, repo: string, branch: string): Promise<boolean> {
  try {
    await gh(token, `/repos/${repo}/branches/${encodeRef(branch)}`);
    return true;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) {
      return false;
    }
    throw error;
  }
}

export async function readTextFile(
  token: string,
  repo: string,
  branch: string,
  path: string,
): Promise<string | null> {
  try {
    const file = await gh<{ content: string; encoding: string }>(
      token,
      `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    );
    if (file.encoding !== "base64") {
      return null;
    }
    const binary = atob(file.content.replace(/\n/g, ""));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export interface CommitOptions {
  token: string;
  repo: string;
  branch?: string;
  baseBranch?: string;
  message: string;
  files: PublishFile[];
  pullRequest?: { title: string; body?: string } | null;
}

export async function commitFiles(options: CommitOptions): Promise<PublishResult> {
  const { token, repo, message, files } = options;
  if (files.length === 0) {
    throw new Error("Nothing to commit.");
  }

  const baseBranch = options.baseBranch || (await getDefaultBranch(token, repo));
  const branch = options.branch || baseBranch;

  const baseRef = await gh<{ object: { sha: string } }>(
    token,
    `/repos/${repo}/git/ref/heads/${encodeRef(baseBranch)}`,
  );
  const baseCommitSha = baseRef.object.sha;

  let headCommitSha = baseCommitSha;
  let branchExists = branch === baseBranch;
  if (!branchExists) {
    try {
      const ref = await gh<{ object: { sha: string } }>(
        token,
        `/repos/${repo}/git/ref/heads/${encodeRef(branch)}`,
      );
      headCommitSha = ref.object.sha;
      branchExists = true;
    } catch (error) {
      if (!(error instanceof GitHubError && error.status === 404)) {
        throw error;
      }
    }
  }

  const headCommit = await gh<{ tree: { sha: string } }>(
    token,
    `/repos/${repo}/git/commits/${headCommitSha}`,
  );

  const blobs = await Promise.all(
    files.map((file) =>
      gh<{ sha: string }>(token, `/repos/${repo}/git/blobs`, {
        method: "POST",
        body: { content: file.contentBase64, encoding: "base64" },
      }),
    ),
  );

  const tree = await gh<{ sha: string }>(token, `/repos/${repo}/git/trees`, {
    method: "POST",
    body: {
      base_tree: headCommit.tree.sha,
      tree: files.map((file, index) => ({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blobs[index].sha,
      })),
    },
  });

  const commit = await gh<{ sha: string; html_url: string }>(
    token,
    `/repos/${repo}/git/commits`,
    {
      method: "POST",
      body: { message, tree: tree.sha, parents: [headCommitSha] },
    },
  );

  if (branchExists) {
    await gh(token, `/repos/${repo}/git/refs/heads/${encodeRef(branch)}`, {
      method: "PATCH",
      body: { sha: commit.sha },
    });
  } else {
    await gh(token, `/repos/${repo}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${branch}`, sha: commit.sha },
    });
  }

  const result: PublishResult = {
    repo,
    branch,
    commitSha: commit.sha,
    commitUrl: commit.html_url,
    paths: files.map((f) => f.path),
  };

  if (options.pullRequest && branch !== baseBranch) {
    const pr = await gh<{ html_url: string }>(token, `/repos/${repo}/pulls`, {
      method: "POST",
      body: {
        title: options.pullRequest.title,
        body: options.pullRequest.body ?? "",
        head: branch,
        base: baseBranch,
      },
    });
    result.pullRequestUrl = pr.html_url;
  }

  return result;
}
