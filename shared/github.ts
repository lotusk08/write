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

function encodeSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
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
    await gh(token, `/repos/${repo}/branches/${encodeSegments(branch)}`);
    return true;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) {
      return false;
    }
    throw error;
  }
}

async function readFile(
  token: string,
  repo: string,
  ref: string,
  path: string,
): Promise<{ content: string; encoding: string; sha: string } | null> {
  try {
    return await gh(token, `/repos/${repo}/contents/${encodeSegments(path)}?ref=${encodeURIComponent(ref)}`);
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

async function graphql<T>(token: string, repo: string, query: string, variables: Record<string, string>): Promise<T> {
  const [owner, name] = repo.split("/");
  const result = await gh<{ data?: { repository: T }; errors?: { message: string }[] }>(token, "/graphql", {
    method: "POST",
    body: { query: `query($owner: String!, $name: String!, ${Object.keys(variables).map((key) => `$${key}: String!`).join(", ")}) { repository(owner: $owner, name: $name) { ${query} } }`, variables: { owner, name, ...variables } },
  });
  if (!result.data) {
    throw new GitHubError(result.errors?.[0]?.message ?? "GitHub did not answer.", 502);
  }
  return result.data.repository;
}

export async function listFiles(token: string, repo: string, ref: string, dir: string): Promise<RepoFile[]> {
  const found = await graphql<{ files: { entries: { name: string; oid: string; type: string }[] } | null }>(
    token,
    repo,
    "files: object(expression: $dir) { ... on Tree { entries { name oid type } } }",
    { dir: `${ref}:${dir}` },
  );
  return (found.files?.entries ?? []).filter((entry) => entry.type === "blob").map(({ name, oid }) => ({ name, sha: oid }));
}

export async function readTexts(
  token: string,
  repo: string,
  branch: string,
  dirs: string[],
): Promise<{ path: string; text: string }[]> {
  const found = await graphql<Record<string, { entries: { name: string; object: { text?: string | null } }[] } | null>>(
    token,
    repo,
    `${dirs.map((_, index) => `d${index}: object(expression: $d${index}) { ... on Tree { entries { name object { ... on Blob { text } } } } }`).join(" ")}`,
    Object.fromEntries(dirs.map((dir, index) => [`d${index}`, `${branch}:${dir}`])),
  );
  return dirs.flatMap((dir, index) =>
    (found[`d${index}`]?.entries ?? []).flatMap((entry) =>
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
    `/repos/${repo}/git/ref/heads/${encodeSegments(branch)}`,
  );
  const headCommitSha = ref.object.sha;
  const { redirects, fresh } = options;

  const [current, existing, headCommit, redirectsFile] = await Promise.all([
    Promise.all((options.expect ?? []).map(({ path }) => readFile(token, repo, headCommitSha, path))),
    fresh?.names.length ? listFiles(token, repo, headCommitSha, fresh.dir) : [],
    gh<{ tree: { sha: string } }>(token, `/repos/${repo}/git/commits/${headCommitSha}`),
    redirects ? readTextFile(token, repo, headCommitSha, redirects.path) : null,
  ]);

  (options.expect ?? []).forEach(({ path, sha }, index) => {
    if ((current[index]?.sha ?? "") !== sha) {
      throw new GitHubError(
        sha
          ? "This post changed on the site since you opened it. Open it again from the site, then publish."
          : `The site already has a post at ${path}. Change its title or date, then publish.`,
        409,
      );
    }
  });
  const taken = new Set(existing.map((file) => stem(file.name)));
  const clash = fresh?.names.find((name) => taken.has(stem(name)));
  if (clash) {
    throw new GitHubError(`A photo called ${clash} is already on the site. Close this and publish again.`, 409);
  }

  const all = [...files];
  if (redirects) {
    const before = redirectsFile?.markdown ?? "";
    const next = mergeRedirects(before, redirects.moves, redirects.created);
    if (next !== before) {
      all.push({ path: redirects.path, contentBase64: bytesToBase64(new TextEncoder().encode(next)) });
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
    await gh(token, `/repos/${repo}/git/refs/heads/${encodeSegments(branch)}`, {
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
