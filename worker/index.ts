import {
  branchExists,
  commitFiles,
  getDefaultBranch,
  GitHubError,
  readTextFile,
  tokenLogin,
} from "../shared/github.ts";
import type {
  AppConfig,
  PublishFile,
  PublishRequest,
  PublishResult,
  Topic,
  Topics,
} from "../shared/types.ts";

export { ShareRoom } from "./share.ts";

export interface Env {
  ASSETS: Fetcher;
  SHARE: DurableObjectNamespace;
  SHARE_RATE?: RateLimit;
  SOURCE_RATE?: RateLimit;
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
const PROPOSAL_BRANCH = /^post\/[a-z0-9][a-z0-9-]{0,99}$/;

function githubToken(env: Env): string {
  return (env.GITHUB_TOKEN ?? "").trim();
}

function dirs(env: Env) {
  return {
    postsDir: env.POSTS_DIR || "src/posts",
    draftsDir: env.DRAFTS_DIR || "src/drafts",
    imagesDir: env.IMAGES_DIR || "public/assets/img/post",
  };
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function sameSecret(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let differences = 0;
  for (let index = 0; index < left.length; index++) {
    differences |= left[index] ^ right[index];
  }
  return differences === 0;
}

const UNSAFE_PATH = /[%?#\\\x00-\x1f\x7f]/;

function repoPath(raw: string): string | null {
  const path = raw.replace(/^\/+/, "");
  if (!path || path.length > 300 || UNSAFE_PATH.test(path)) {
    return null;
  }
  return path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ? null
    : path;
}

async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get("content-length") ?? "0") > max) {
    return null;
  }
  if (!request.body) {
    return new Uint8Array();
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function noindex(response: Response): Response {
  if (response.status === 101) {
    return response;
  }
  const marked = new Response(response.body, response);
  marked.headers.set("x-robots-tag", "noindex");
  return marked;
}

async function limited(limiter: RateLimit | undefined, request: Request, scope: string): Promise<boolean> {
  if (!limiter) {
    return false;
  }
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  const { success } = await limiter.limit({ key: `${scope}:${ip}` });
  return !success;
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
  if (!env.WRITE_PASSWORD?.trim()) {
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
      "x-robots-tag": "noindex",
    },
  });
}

function crossSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

async function authorize(request: Request, env: Env): Promise<Response | null> {
  const missing = problem(env);
  if (missing) {
    return json({ error: missing }, env.GITHUB_TOKEN ? 500 : 501);
  }
  const supplied = request.headers.get("x-write-password") ?? "";
  if (!(await sameSecret(supplied, env.WRITE_PASSWORD!))) {
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
    const path = repoPath(file.path);
    if (!path) {
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

const TOPICS_TTL = 300;

function topicList(value: unknown): Topic[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((topic) => typeof topic?.title === "string" && typeof topic?.slug === "string")
    .slice(0, 2000)
    .map((topic) => ({
      title: String(topic.title).slice(0, 200),
      slug: String(topic.slug).slice(0, 200),
      count: Number.isFinite(topic.count) ? Number(topic.count) : 0,
    }));
}

async function handleTopics(env: Env): Promise<Response> {
  const none: Topics = { tags: [] };
  const site = (env.SITE_URL || "").replace(/\/+$/, "");
  if (!site) {
    return json(none);
  }
  try {
    const response = await fetch(`${site}/topics.json`, {
      headers: { accept: "application/json" },
      cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": TOPICS_TTL, "300-599": 60 } },
    });
    if (!response.ok) {
      return json(none);
    }
    const body = (await response.json()) as Partial<Record<keyof Topics, unknown>>;
    return json({ tags: topicList(body.tags) });
  } catch {
    return json(none);
  }
}

async function handlePublish(request: Request, env: Env): Promise<Response> {
  const denied = await authorize(request, env);
  if (denied) {
    return denied;
  }

  const raw = await readCapped(request, MAX_REQUEST_BYTES + 1024 * 1024);
  if (!raw) {
    return json({ error: "Publish payload is too large (max ~20 MB)." }, 400);
  }
  let body: PublishRequest;
  try {
    body = JSON.parse(new TextDecoder().decode(raw)) as PublishRequest;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const checked = validateFiles(body.files, env);
  if ("error" in checked) {
    return json({ error: checked.error }, 400);
  }

  const base = env.BLOG_BRANCH || "main";
  const proposed = typeof body.branch === "string" && PROPOSAL_BRANCH.test(body.branch);
  if (body.branch !== undefined && body.branch !== null && body.branch !== base && !proposed) {
    return json({ error: `Publishing goes to ${base}, or to a post/<slug> branch for a pull request.` }, 400);
  }
  const branch = proposed ? (body.branch as string) : base;

  const message =
    (typeof body.message === "string" ? body.message : "").trim().slice(0, 500) ||
    "post: update from write";

  try {
    const result: PublishResult = await commitFiles({
      token: githubToken(env),
      repo: env.BLOG_REPO!,
      branch,
      baseBranch: env.BLOG_BRANCH || undefined,
      message,
      files: checked.files,
      pullRequest:
        proposed && body.pullRequest && typeof body.pullRequest.title === "string"
          ? {
              title: body.pullRequest.title.slice(0, 200),
              body: typeof body.pullRequest.body === "string" ? body.pullRequest.body.slice(0, 2000) : "",
            }
          : null,
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
  const requested = url.searchParams.get("path") ?? "";
  const path = repoPath(requested);
  const allowed = Object.values(dirs(env)).map((dir) => `${dir.replace(/\/+$/, "")}/`);
  if (!path || !allowed.some((dir) => path.startsWith(dir))) {
    return json({ error: `Path outside the allowed directories (${allowed.join(", ")}): ${requested}` }, 400);
  }
  if (await limited(env.SOURCE_RATE, request, "source")) {
    return json({ error: "Too many requests — wait a minute and try again." }, 429);
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
    const denied = await authorize(request, env);
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
  if (crossSite(request)) {
    return json({ error: "Shares can only be managed from the app itself." }, 403);
  }
  if (await limited(env.SHARE_RATE, request, "share")) {
    return json(
      { error: "Too many new shares from this connection — wait a minute and try again." },
      429,
    );
  }
  const seed = await readCapped(request, SHARE_SEED_MAX_BYTES);
  if (!seed) {
    return json({ error: "Draft is too large to share (max ~4 MB)." }, 400);
  }
  const token = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const room = env.SHARE.get(env.SHARE.idFromName(token));
  const seeded = await room.fetch("https://share/seed", { method: "POST", body: seed });
  if (seeded.status === 400) {
    return json({ error: "That is not a draft the app can share." }, 400);
  }
  if (!seeded.ok) {
    return json({ error: "Could not start the share." }, 500);
  }
  return json({ token });
}

async function handleShareRoom(request: Request, env: Env, token: string): Promise<Response> {
  const room = env.SHARE.get(env.SHARE.idFromName(token));
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return noindex(await room.fetch(request));
  }
  if (request.method === "DELETE") {
    if (crossSite(request)) {
      return json({ error: "Shares can only be managed from the app itself." }, 403);
    }
    return noindex(await room.fetch("https://share/", { method: "DELETE" }));
  }
  if (request.method === "GET") {
    return noindex(await room.fetch("https://share/", { method: "GET" }));
  }
  return json({ error: "Use GET, DELETE, or a WebSocket." }, 405);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/config") {
      return request.method === "GET" ? handleConfig(env) : json({ error: "Use GET." }, 405);
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
    if (url.pathname === "/api/topics") {
      return request.method === "GET" ? handleTopics(env) : json({ error: "Use GET." }, 405);
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found." }, 404);
    }

    const asset = await env.ASSETS.fetch(request);
    const page = new Response(asset.body, asset);
    page.headers.set("x-robots-tag", "noindex");
    return page;
  },
} satisfies ExportedHandler<Env>;
