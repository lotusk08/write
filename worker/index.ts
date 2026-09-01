import {
  branchExists,
  commitFiles,
  getDefaultBranch,
  GitHubError,
  readTextFile,
  tokenLogin,
} from "../shared/github.ts";
import type { AppConfig, PublishFile, PublishRequest, PublishResult } from "../shared/types.ts";

export { ShareRoom } from "./share.ts";

export interface Env {
  ASSETS: Fetcher;
  SHARE: DurableObjectNamespace;
  GITHUB_TOKEN?: string;
  WRITE_PASSWORD?: string;
  BLOG_REPO?: string;
  BLOG_BRANCH?: string;
  SITE_URL?: string;
  POSTS_DIR?: string;
  DRAFTS_DIR?: string;
  IMAGES_DIR?: string;
}

const MAX_REQUEST_BYTES = 20 * 1024 * 1024;

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

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let differences = 0;
  for (let index = 0; index < a.length; index++) {
    differences |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return differences === 0;
}

function unreachable(env: Env): string | null {
  if (!env.GITHUB_TOKEN) {
    return "This deployment has no GITHUB_TOKEN, so it cannot reach the blog. Add one with `wrangler secret put GITHUB_TOKEN`.";
  }
  if (!env.BLOG_REPO) {
    return "No BLOG_REPO configured on this deployment.";
  }
  return null;
}

function problem(env: Env): string | null {
  if (!env.GITHUB_TOKEN) {
    return unreachable(env);
  }
  if (!env.WRITE_PASSWORD) {
    return "Publishing is disabled until WRITE_PASSWORD is set (`wrangler secret put WRITE_PASSWORD`), otherwise this endpoint would let anyone write to the blog.";
  }
  return unreachable(env);
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

function authorize(request: Request, env: Env): Response | null {
  const missing = problem(env);
  if (missing) {
    return json({ error: missing }, env.GITHUB_TOKEN ? 500 : 501);
  }
  const supplied = request.headers.get("x-write-password") ?? "";
  if (!sameSecret(supplied, env.WRITE_PASSWORD!)) {
    return json({ error: supplied ? "Wrong password." : "This needs the publish password." }, 401);
  }
  return null;
}

function upstreamStatus(error: unknown): number {
  if (!(error instanceof GitHubError)) {
    return 500;
  }
  return error.status === 401 || error.status === 403 ? 502 : error.status;
}

const BRANCH_RE = /^[A-Za-z0-9._\-/]{1,120}$/;

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

function handleConfig(env: Env): Response {
  const missing = problem(env);
  const config: AppConfig = {
    repo: env.BLOG_REPO || "",
    branch: env.BLOG_BRANCH || "main",
    siteUrl: env.SITE_URL || "",
    ...dirs(env),
    ready: !missing,
    ...(missing ? { problem: missing } : {}),
  };
  return json(config);
}

async function handlePublish(request: Request, env: Env): Promise<Response> {
  const denied = authorize(request, env);
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
    return json(
      { error: error instanceof Error ? error.message : "Publish failed." },
      upstreamStatus(error),
    );
  }
}

async function whyMissing(env: Env, branch: string, path: string): Promise<string> {
  const repo = env.BLOG_REPO!;
  const token = githubToken(env);
  try {
    await getDefaultBranch(token, repo);
  } catch {
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
  }
  return `No such file on ${repo}@${branch}: ${path}`;
}

async function handleSource(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = (url.searchParams.get("path") ?? "").replace(/^\/+/, "");
  const allowed = Object.values(dirs(env)).map((dir) => `${dir.replace(/\/+$/, "")}/`);
  if (path.includes("..") || !allowed.some((dir) => path.startsWith(dir))) {
    return json({ error: `Path outside the allowed directories (${allowed.join(", ")}): ${path}` }, 400);
  }
  if (!/\.(md|markdown)$/i.test(path)) {
    return json({ error: "Only Markdown files can be opened." }, 400);
  }

  const published = path.startsWith(`${dirs(env).postsDir.replace(/\/+$/, "")}/`);
  if (published) {
    const missing = unreachable(env);
    if (missing) {
      return json({ error: missing }, env.GITHUB_TOKEN ? 500 : 501);
    }
  } else {
    const denied = authorize(request, env);
    if (denied) {
      return denied;
    }
  }

  const branch = env.BLOG_BRANCH || "main";
  try {
    const markdown = await readTextFile(githubToken(env), env.BLOG_REPO!, branch, path);
    if (markdown === null) {
      return json({ error: await whyMissing(env, branch, path) }, 404);
    }
    return json({ path, branch, markdown });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Read failed." },
      upstreamStatus(error),
    );
  }
}

const SHARE_SEED_MAX_BYTES = 4 * 1024 * 1024;
const SHARE_PATH = /^\/api\/share\/([0-9a-f]{32})$/;

async function handleShareCreate(request: Request, env: Env): Promise<Response> {
  const denied = authorize(request, env);
  if (denied) {
    return denied;
  }
  const seed = await request.arrayBuffer();
  if (seed.byteLength > SHARE_SEED_MAX_BYTES) {
    return json({ error: "Draft is too large to share (max ~4 MB)." }, 400);
  }
  const token = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const room = env.SHARE.get(env.SHARE.idFromName(token));
  const seeded = await room.fetch("https://share/seed", { method: "POST", body: seed });
  if (!seeded.ok) {
    return json({ error: "Could not start the share." }, 500);
  }
  return json({ token });
}

async function handleShareRoom(request: Request, env: Env, token: string): Promise<Response> {
  const room = env.SHARE.get(env.SHARE.idFromName(token));
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return room.fetch(request);
  }
  if (request.method === "DELETE") {
    const denied = authorize(request, env);
    if (denied) {
      return denied;
    }
    return room.fetch("https://share/", { method: "DELETE" });
  }
  if (request.method === "GET") {
    return room.fetch("https://share/", { method: "GET" });
  }
  return json({ error: "Use GET, DELETE, or a WebSocket." }, 405);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/config") {
      return handleConfig(env);
    }
    if (url.pathname === "/api/share") {
      return request.method === "POST"
        ? handleShareCreate(request, env)
        : json({ error: "Use POST." }, 405);
    }
    const share = SHARE_PATH.exec(url.pathname);
    if (share) {
      return handleShareRoom(request, env, share[1]);
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

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
