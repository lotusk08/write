import {
  branchExists,
  commitFiles,
  getDefaultBranch,
  GitHubError,
  readTextFile,
  tokenLogin,
} from "../shared/github.ts";
import type { AppConfig, PublishFile, PublishRequest, PublishResult } from "../shared/types.ts";
import { verifyAccess, type AccessConfig } from "./access.ts";

export interface Env {
  ASSETS: Fetcher;
  /** Fine-grained PAT with Contents: Read & write on the blog repo. Secret. */
  GITHUB_TOKEN?: string;
  /** `example.cloudflareaccess.com` — the Zero Trust team this app belongs to. */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's Audience tag. */
  ACCESS_AUD?: string;
  /** Optional belt and braces: the one address allowed to publish. */
  ACCESS_EMAIL?: string;
  BLOG_REPO?: string;
  BLOG_BRANCH?: string;
  /** Public site URL, used to preview images already published. */
  SITE_URL?: string;
  POSTS_DIR?: string;
  DRAFTS_DIR?: string;
  IMAGES_DIR?: string;
}

/** 20 MB of base64 across a single commit — comfortably under the API limits. */
const MAX_REQUEST_BYTES = 20 * 1024 * 1024;

/**
 * Secrets are often piped in, and a trailing newline in the header makes
 * GitHub treat the request as anonymous — which a private repo answers with a
 * flat "not found".
 */
function githubToken(env: Env): string {
  return (env.GITHUB_TOKEN ?? "").trim();
}

function dirs(env: Env) {
  return {
    postsDir: env.POSTS_DIR || "_posts",
    draftsDir: env.DRAFTS_DIR || "_drafts",
    imagesDir: env.IMAGES_DIR || "assets/img/post",
  };
}

function accessConfig(env: Env): AccessConfig | null {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return null;
  }
  return {
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    aud: env.ACCESS_AUD,
    ...(env.ACCESS_EMAIL ? { email: env.ACCESS_EMAIL } : {}),
  };
}

/** What is missing before this deployment can publish, in the order to fix it. */
function problem(env: Env): string | null {
  if (!env.GITHUB_TOKEN) {
    return "This deployment has no GITHUB_TOKEN, so it cannot reach the blog. Add one with `wrangler secret put GITHUB_TOKEN`.";
  }
  if (!accessConfig(env)) {
    return "Publishing is disabled until Cloudflare Access is configured: set ACCESS_TEAM_DOMAIN and ACCESS_AUD in wrangler.jsonc. Without them this endpoint would let anyone write to the blog.";
  }
  if (!env.BLOG_REPO) {
    return "No BLOG_REPO configured on this deployment.";
  }
  return null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * Guards everything that touches the blog. The order matters: a deployment
 * that is not configured says so plainly, and one that is verifies the caller
 * before it will use its token for them.
 */
async function authorize(request: Request, env: Env): Promise<Response | null> {
  const missing = problem(env);
  if (missing) {
    return json({ error: missing }, env.GITHUB_TOKEN ? 500 : 501);
  }
  try {
    await verifyAccess(request, accessConfig(env)!);
    return null;
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Not signed in." }, 403);
  }
}

const BRANCH_RE = /^[A-Za-z0-9._\-/]{1,120}$/;

/**
 * Only ever writes inside the configured post/draft/image directories, so a
 * session someone else got hold of cannot rewrite workflows or other files.
 */
function validateFiles(files: unknown, env: Env): { files: PublishFile[] } | { error: string } {
  if (!Array.isArray(files) || files.length === 0) {
    return { error: "No files to publish." };
  }
  if (files.length > 50) {
    return { error: "Too many files in one publish (max 50)." };
  }

  const allowed = Object.values(dirs(env)).map((dir) => `${dir.replace(/\/+$/, "")}/`);
  const validated: PublishFile[] = [];
  let total = 0;

  for (const file of files as PublishFile[]) {
    if (typeof file?.path !== "string" || typeof file?.contentBase64 !== "string") {
      return { error: "Malformed file entry." };
    }
    const path = file.path.replace(/^\/+/, "");
    if (path.includes("..") || path.includes("//") || path.length > 300) {
      return { error: `Unsafe path: ${file.path}` };
    }
    if (!allowed.some((dir) => path.startsWith(dir))) {
      return { error: `Path outside the allowed directories (${allowed.join(", ")}): ${path}` };
    }
    if (!/^[A-Za-z0-9+/=\s]*$/.test(file.contentBase64)) {
      return { error: `File content is not base64: ${path}` };
    }
    total += file.contentBase64.length;
    validated.push({ path, contentBase64: file.contentBase64.replace(/\s+/g, "") });
  }

  if (total > MAX_REQUEST_BYTES) {
    return { error: "Publish payload is too large (max ~20 MB)." };
  }
  return { files: validated };
}

async function handleConfig(request: Request, env: Env): Promise<Response> {
  const missing = problem(env);
  const access = accessConfig(env);
  let email: string | undefined;
  if (access) {
    email = await verifyAccess(request, access)
      .then((identity) => identity.email)
      .catch(() => undefined);
  }
  const config: AppConfig = {
    repo: env.BLOG_REPO || "",
    branch: env.BLOG_BRANCH || "main",
    siteUrl: env.SITE_URL || "",
    ...dirs(env),
    ready: !missing,
    ...(missing ? { problem: missing } : {}),
    ...(email ? { email } : {}),
  };
  return json(config);
}

async function handlePublish(request: Request, env: Env): Promise<Response> {
  const denied = await authorize(request, env);
  if (denied) {
    return denied;
  }

  let body: PublishRequest;
  try {
    body = (await request.json()) as PublishRequest;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const checked = validateFiles(body.files, env);
  if ("error" in checked) {
    return json({ error: checked.error }, 400);
  }

  const branch = body.branch?.trim() || env.BLOG_BRANCH || "main";
  if (!BRANCH_RE.test(branch)) {
    return json({ error: `Invalid branch name: ${branch}` }, 400);
  }

  const message = (body.message || "").trim().slice(0, 500) || "post: update from write";

  try {
    const result: PublishResult = await commitFiles({
      token: githubToken(env),
      repo: env.BLOG_REPO!,
      branch,
      baseBranch: env.BLOG_BRANCH || undefined,
      message,
      files: checked.files,
      pullRequest: body.pullRequest ?? null,
    });
    return json(result);
  } catch (error) {
    const status = error instanceof GitHubError ? error.status : 500;
    return json({ error: error instanceof Error ? error.message : "Publish failed." }, status);
  }
}

/**
 * GitHub answers 404 both for a file that is not there and for a repository a
 * token was never granted, which are very different things to fix. Only runs
 * when a read has already failed, so the extra calls cost nothing in normal
 * use.
 */
async function whyMissing(env: Env, branch: string, path: string): Promise<string> {
  const repo = env.BLOG_REPO!;
  const token = githubToken(env);
  try {
    await getDefaultBranch(token, repo);
  } catch {
    // Whether GitHub knows who is asking separates a bad token from a good
    // token that was never given this repository.
    const login = await tokenLogin(token);
    return login
      ? `The token authenticates as @${login}, but that account cannot see ${repo}. Add the repository under the token's "Repository access" and give it Contents: Read & write — GitHub reports a private repo as "not found" for a token it was not granted.`
      : "GitHub rejected this deployment's token: it did not authenticate at all. Check GITHUB_TOKEN has not expired and was stored without stray spaces or line breaks (`wrangler secret put GITHUB_TOKEN`, pasted at the prompt rather than piped).";
  }
  try {
    if (!(await branchExists(token, repo, branch))) {
      return `${repo} has no branch called "${branch}". Point BLOG_BRANCH at the branch the posts are on.`;
    }
  } catch {
    // The branch check is only here to explain things; ignore its failures.
  }
  return `No such file on ${repo}@${branch}: ${path}`;
}

/** Reads one post back out of the repo so it can be edited here. */
async function handleSource(request: Request, env: Env): Promise<Response> {
  const denied = await authorize(request, env);
  if (denied) {
    return denied;
  }

  const url = new URL(request.url);
  const path = (url.searchParams.get("path") ?? "").replace(/^\/+/, "");
  const allowed = Object.values(dirs(env)).map((dir) => `${dir.replace(/\/+$/, "")}/`);
  if (path.includes("..") || !allowed.some((dir) => path.startsWith(dir))) {
    return json({ error: `Path outside the allowed directories (${allowed.join(", ")}): ${path}` }, 400);
  }
  if (!/\.(md|markdown)$/i.test(path)) {
    return json({ error: "Only Markdown files can be opened." }, 400);
  }

  const branch = env.BLOG_BRANCH || "main";
  try {
    const markdown = await readTextFile(githubToken(env), env.BLOG_REPO!, branch, path);
    if (markdown === null) {
      return json({ error: await whyMissing(env, branch, path) }, 404);
    }
    return json({ path, branch, markdown });
  } catch (error) {
    const status = error instanceof GitHubError ? error.status : 500;
    return json({ error: error instanceof Error ? error.message : "Read failed." }, status);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/config") {
      return handleConfig(request, env);
    }
    if (url.pathname === "/api/publish") {
      return request.method === "POST"
        ? handlePublish(request, env)
        : json({ error: "Use POST." }, 405);
    }
    if (url.pathname === "/api/source") {
      return request.method === "GET"
        ? handleSource(request, env)
        : json({ error: "Use GET." }, 405);
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found." }, 404);
    }

    // Everything else is the SPA; `not_found_handling` serves index.html.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
