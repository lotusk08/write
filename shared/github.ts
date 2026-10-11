import { bytesToBase64 } from "./base64.ts";
import { stem } from "./paths.ts";
import { mergeRedirects } from "./redirects.ts";
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

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function readFile(
  token: string,
  repo: string,
  ref: string,
  path: string,
): Promise<{ content: string; encoding: string; sha: string } | null> {
  try {
    return await gh(token, `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function readTextFile(
  token: string,
  repo: string,
  branch: string,
  path: string,
): Promise<{ markdown: string; sha: string } | null> {
  const file = await readFile(token, repo, branch, path);
  if (!file || file.encoding !== "base64") {
    return null;
  }
  const binary = atob(file.content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return { markdown: new TextDecoder().decode(bytes), sha: file.sha };
}

export interface RepoFile {
  name: string;
  sha: string;
}

export async function listFiles(token: string, repo: string, ref: string, dir: string): Promise<RepoFile[]> {
  try {
    const entries = await gh<{ name: string; sha: string; type: string }[]>(
      token,
      `/repos/${repo}/contents/${encodePath(dir)}?ref=${encodeURIComponent(ref)}`,
    );
    return Array.isArray(entries)
      ? entries.filter((entry) => entry.type === "file").map(({ name, sha }) => ({ name, sha }))
      : [];
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) {
      return [];
    }
    throw error;
  }
}

export async function readTexts(
  token: string,
  repo: string,
  branch: string,
  dirs: string[],
): Promise<{ path: string; text: string }[]> {
  const [owner, name] = repo.split("/");
  const fields = dirs.map((_, index) => `d${index}: object(expression: $d${index}) { ...T }`).join(" ");
  const params = dirs.map((_, index) => `$d${index}: String!`).join(", ");
  const result = await gh<{
    data?: { repository: Record<string, { entries: { name: string; object: { text?: string | null } }[] } | null> };
    errors?: { message: string }[];
  }>(token, "/graphql", {
    method: "POST",
    body: {
      query: `query($owner: String!, $name: String!, ${params}) { repository(owner: $owner, name: $name) { ${fields} } } fragment T on Tree { entries { name object { ... on Blob { text } } } }`,
      variables: { owner, name, ...Object.fromEntries(dirs.map((dir, index) => [`d${index}`, `${branch}:${dir}`])) },
    },
  });
  if (!result.data) {
    throw new GitHubError(result.errors?.[0]?.message ?? "GitHub did not answer.", 502);
  }
  return dirs.flatMap((dir, index) =>
    (result.data!.repository[`d${index}`]?.entries ?? []).flatMap((entry) =>
      typeof entry.object.text === "string" ? [{ path: `${dir}/${entry.name}`, text: entry.object.text }] : [],
    ),
  );
}

export async function createBlob(token: string, repo: string, contentBase64: string): Promise<string> {
  const blob = await gh<{ sha: string }>(token, `/repos/${repo}/git/blobs`, {
    method: "POST",
    body: { content: contentBase64, encoding: "base64" },
  });
  return blob.sha;
}

export interface CommitOptions {
  token: string;
  repo: string;
  branch?: string;
  message: string;
  files: PublishFile[];
  expect?: { path: string; sha: string }[];
  fresh?: { dir: string; names: string[] };
  remove?: string[];
  redirects?: { path: string; moves: [string, string][]; created: string[] };
}

export async function commitFiles(options: CommitOptions): Promise<PublishResult> {
  const { token, repo, message, files } = options;
  if (files.length === 0) {
    throw new Error("Nothing to commit.");
  }

  const branch = options.branch || (await getDefaultBranch(token, repo));

  const ref = await gh<{ object: { sha: string } }>(
    token,
    `/repos/${repo}/git/ref/heads/${encodeRef(branch)}`,
  );
  const headCommitSha = ref.object.sha;

  for (const { path, sha } of options.expect ?? []) {
    const current = await readFile(token, repo, headCommitSha, path);
    if ((current?.sha ?? "") !== sha) {
      throw new GitHubError(
        sha
          ? "This post changed on the site since you opened it. Open it again from the site, then publish."
          : `The site already has a post at ${path}. Change its title or date, then publish.`,
        409,
      );
    }
  }
  if (options.fresh?.names.length) {
    const existing = new Set((await listFiles(token, repo, headCommitSha, options.fresh.dir)).map((file) => stem(file.name)));
    const clash = options.fresh.names.find((name) => existing.has(stem(name)));
    if (clash) {
      throw new GitHubError(`A photo called ${clash} is already on the site. Close this and publish again.`, 409);
    }
  }

  const headCommit = await gh<{ tree: { sha: string } }>(
    token,
    `/repos/${repo}/git/commits/${headCommitSha}`,
  );

  const all = [...files];
  if (options.redirects) {
    const { path, moves, created } = options.redirects;
    const current = (await readTextFile(token, repo, headCommitSha, path))?.markdown ?? "";
    const next = mergeRedirects(current, moves, created);
    if (next !== current) {
      all.push({ path, contentBase64: bytesToBase64(new TextEncoder().encode(next)) });
    }
  }

  const shas = await Promise.all(
    all.map((file) => ("sha" in file ? file.sha : createBlob(token, repo, file.contentBase64))),
  );

  const tree = await gh<{ sha: string }>(token, `/repos/${repo}/git/trees`, {
    method: "POST",
    body: {
      base_tree: headCommit.tree.sha,
      tree: [
        ...all.map((file, index) => ({ path: file.path, mode: "100644", type: "blob", sha: shas[index] })),
        ...(options.remove ?? []).map((path) => ({ path, mode: "100644", type: "blob", sha: null })),
      ],
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

  try {
    await gh(token, `/repos/${repo}/git/refs/heads/${encodeRef(branch)}`, {
      method: "PATCH",
      body: { sha: commit.sha },
    });
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422) {
      throw new GitHubError("Someone published at the same moment. Publish again.", 409);
    }
    throw error;
  }

  return {
    repo,
    branch,
    commitSha: commit.sha,
    commitUrl: commit.html_url,
    paths: all.map((f) => f.path),
    shas: Object.fromEntries(all.map((file, index) => [file.path, shas[index]])),
  };
}
