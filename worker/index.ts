import {
  branchExists,
  commitFiles,
  createBlob,
  getDefaultBranch,
  GitHubError,
  listFiles,
  readTexts,
  readTextFile,
  tokenLogin,
} from "../shared/github.ts";
import type {
  AppConfig,
  PublishFile,
  PublishRequest,
  PublishResult,
  SiteFile,
  SiteFiles,
  Topic,
  Topics,
} from "../shared/types.ts";

import { frontField, frontMatter } from "../shared/front.ts";
import {
  MAX_POSTER_BYTES,
  MAX_VIDEO_BYTES,
  type MediaPart,
  type MediaStart,
  PART_BYTES,
  POSTER_TYPES,
  posterKey,
  VIDEO_KEY,
  VIDEO_TYPES,
  videoKey,
  videoKeysIn,
  dropboxFile,
  isDropbox,
  type MediaVideo,
} from "../shared/media.ts";
import { decoded, fileDate, servedName, stem, trimSlashes } from "../shared/paths.ts";
import { readPin } from "../shared/pin.ts";
import { redirectSources, REDIRECTS_PATH } from "../shared/redirects.ts";
import {
  ALGORITHMS,
  base64url,
  challengeExpiry,
  type ChallengePurpose,
  checkCeremony,
  fromBase64url,
  importKey,
  issueChallenge,
  issueSession,
  type Passkeys,
  validSession,
  verifySignature,
} from "./passkeys.ts";

export { ShareRoom } from "./share.ts";
export { Passkeys } from "./passkeys.ts";

export interface Env {
  ASSETS: Fetcher;
  SHARE: DurableObjectNamespace;
  PASSKEYS: DurableObjectNamespace<Passkeys>;
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
  PAGES_DIR?: string;
  MEDIA?: R2Bucket;
  MEDIA_URL?: string;
}

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_PHOTO_BYTES = Math.ceil((8 * 1024 * 1024 * 4) / 3) + 4;
const SHA = /^[0-9a-f]{40}$/;
const MARKDOWN = /\.(md|markdown)$/i;

const PASSKEY_BODY_BYTES = 16 * 1024;
const MEDIA_DEPTH = 4;
const MAX_KEEP = 500;

function githubToken(env: Env): string {
  return (env.GITHUB_TOKEN ?? "").trim();
}

function dirs(env: Env) {
  return {
    postsDir: trimSlashes(env.POSTS_DIR || "src/posts"),
    draftsDir: trimSlashes(env.DRAFTS_DIR || "src/drafts"),
    imagesDir: trimSlashes(env.IMAGES_DIR || "public/assets/img/post"),
  };
}

function allowedDirs(env: Env): string[] {
  return Object.values(dirs(env)).map((dir) => `${dir}/`);
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

// eslint-disable-next-line no-control-regex -- control characters are what this matches
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

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "media-src 'self' https: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https: blob: data:",
    "frame-src 'self' https://www.youtube-nocookie.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex",
};

function nonced(policy: string): string {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  return policy.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`);
}

function secured(response: Response): Response {
  if (response.status === 101) {
    return response;
  }
  const marked = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    marked.headers.set(name, value);
  }
  if (marked.headers.get("content-type")?.startsWith("text/html")) {
    marked.headers.set("content-security-policy", nonced(SECURITY_HEADERS["content-security-policy"]));
  }
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
  if (env.GITHUB_TOKEN && !env.WRITE_PASSWORD?.trim()) {
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

async function authorize(
  request: Request,
  env: Env,
  { passwordOnly = false }: { passwordOnly?: boolean } = {},
): Promise<Response | null> {
  const missing = problem(env);
  if (missing) {
    return misconfigured(missing, env);
  }
  const session = request.headers.get("x-write-session");
  if (!passwordOnly && session && (await validSession(session, env.WRITE_PASSWORD!))) {
    return null;
  }
  const supplied = request.headers.get("x-write-password") ?? "";
  if (!supplied) {
    return json({ error: "This needs the publish password." }, 401);
  }
  const ok = await sameSecret(supplied, env.WRITE_PASSWORD!);
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  const verdict = await passkeyStore(env).attempt(`password:${ip}`, ok);
  if (verdict === "blocked") {
    return json({ error: "Too many wrong passwords from this connection — wait 15 minutes and try again." }, 429);
  }
  return verdict === "ok" ? null : json({ error: "Wrong password." }, 401);
}

function upstreamStatus(error: unknown): number {
  if (!(error instanceof GitHubError)) {
    return 500;
  }
  return error.status === 401 || error.status === 403 ? 502 : error.status;
}

function failed(error: unknown, fallback: string): Response {
  return json({ error: error instanceof Error ? error.message : fallback }, upstreamStatus(error));
}

function misconfigured(missing: string, env: Env): Response {
  return json({ error: missing }, env.GITHUB_TOKEN ? 500 : 501);
}

function tooMany(): Response {
  return json({ error: "Too many requests — wait a minute and try again." }, 429);
}

function validateFiles(files: unknown, env: Env): { files: PublishFile[] } | { error: string } {
  if (!Array.isArray(files) || files.length === 0) {
    return { error: "No files to publish." };
  }
  if (files.length > 50) {
    return { error: "Too many files in one publish (max 50)." };
  }

  const allowed = allowedDirs(env);
  const validated: PublishFile[] = [];

  for (const file of files as PublishFile[]) {
    const entry = typeof file === "object" && file !== null;
    const sha = entry && "sha" in file ? file.sha : undefined;
    const content = entry && "contentBase64" in file ? file.contentBase64 : undefined;
    if (typeof file?.path !== "string" || (typeof content !== "string" && !(typeof sha === "string" && SHA.test(sha)))) {
      return { error: "Malformed file entry." };
    }
    const path = repoPath(file.path);
    if (!path) {
      return { error: `Unsafe path: ${file.path}` };
    }
    if (!allowed.some((dir) => path.startsWith(dir))) {
      return { error: `Path outside the allowed directories (${allowed.join(", ")}): ${path}` };
    }
    if (typeof content !== "string") {
      validated.push({ path, sha: sha! });
      continue;
    }
    if (!/^[A-Za-z0-9+/=\s]*$/.test(content)) {
      return { error: `File content is not base64: ${path}` };
    }
    validated.push({ path, contentBase64: content.replace(/\s+/g, "") });
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
    ...(mediaBase(env) ? { media: mediaBase(env) } : {}),
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

function textDirs(env: Env): string[] {
  const { postsDir, draftsDir } = dirs(env);
  return [postsDir, draftsDir, trimSlashes(env.PAGES_DIR || "src/pages")];
}

function servedDir(env: Env): string {
  return `/${dirs(env).imagesDir.replace(/^public\//, "")}/`;
}

function validList<T>(value: unknown, valid: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.length <= 50 && value.every(valid);
}

async function handlePublish(request: Request, env: Env): Promise<Response> {
  const denied = await authorize(request, env);
  if (denied) {
    return denied;
  }

  const raw = await readCapped(request, MAX_REQUEST_BYTES);
  if (!raw) {
    return json({ error: "This post is too large to publish (max ~4 MB of text)." }, 400);
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
  const { postsDir, draftsDir, imagesDir } = dirs(env);
  const markdownPath = (path: unknown): path is string =>
    typeof path === "string" &&
    repoPath(path) === path &&
    (path.startsWith(`${postsDir}/`) || path.startsWith(`${draftsDir}/`)) &&
    MARKDOWN.test(path);
  const expect = body.expect;
  const guard = (entry: unknown): entry is { path: string; sha: string } =>
    typeof entry === "object" && entry !== null && markdownPath((entry as { path?: unknown }).path) &&
    typeof (entry as { sha?: unknown }).sha === "string" && ((entry as { sha: string }).sha === "" || SHA.test((entry as { sha: string }).sha));
  if (expect !== undefined && !validList(expect, guard)) {
    return json({ error: "Malformed expect entry." }, 400);
  }
  const remove = body.remove ?? [];
  const removable = (path: unknown): path is string =>
    typeof path === "string" &&
    repoPath(path) === path &&
    (path.startsWith(`${imagesDir}/`) || (path.startsWith(`${draftsDir}/`) && markdownPath(path)));
  if (!validList(remove, removable)) {
    return json({ error: "Malformed remove entry." }, 400);
  }
  const served = servedDir(env);
  const moves = body.redirects ?? [];
  const address = (value: unknown): value is string =>
    typeof value === "string" && value.startsWith(served) && !/[\s/]/.test(value.slice(served.length)) && value.length > served.length;
  const move = (pair: unknown): pair is [string, string] => Array.isArray(pair) && pair.length === 2 && pair.every(address);
  if (!validList(moves, move)) {
    return json({ error: "Malformed redirect entry." }, 400);
  }
  const names = checked.files
    .filter((file) => file.path.startsWith(`${imagesDir}/`))
    .map((file) => file.path.slice(imagesDir.length + 1));
  const retire = body.retire ?? [];
  const keep = body.keep ?? [];
  if (!validList(retire, isVideoKey) || !Array.isArray(keep) || keep.length > MAX_KEEP || !keep.every(isVideoKey)) {
    return json({ error: "Malformed retire or keep entry." }, 400);
  }
  if (body.sweep !== undefined && typeof body.sweep !== "boolean") {
    return json({ error: "Malformed sweep flag." }, 400);
  }
  const sweep = mediaBase(env) ? await videosLeaving(env, checked.files, remove, retire, keep, body.sweep !== false).catch(() => null) : null;

  const message =
    (typeof body.message === "string" ? body.message : "").trim().slice(0, 500) ||
    "post: update from write";

  try {
    const result: PublishResult = await commitFiles({
      token: githubToken(env),
      repo: env.BLOG_REPO!,
      branch: env.BLOG_BRANCH || undefined,
      message,
      files: checked.files,
      expect,
      fresh: { dir: imagesDir, names },
      remove,
      redirects: {
        path: REDIRECTS_PATH,
        moves,
        created: names.map((name) => `${served}${encodeURIComponent(servedName(name))}`),
      },
    });
    const retired = sweep?.candidates.length ? await removeUnused(env, sweep).catch(() => []) : [];
    return json({ ...result, ...(retired.length ? { retired } : {}) } satisfies PublishResult);
  } catch (error) {
    return failed(error, "Publish failed.");
  }
}

async function handlePhoto(request: Request, env: Env): Promise<Response> {
  const denied = await authorize(request, env);
  if (denied) {
    return denied;
  }
  const raw = await readCapped(request, MAX_PHOTO_BYTES);
  if (!raw) {
    return json({ error: "This photo is too large to publish (max 8 MB)." }, 400);
  }
  const content = new TextDecoder().decode(raw);
  if (!content || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) {
    return json({ error: "The photo was not sent as base64." }, 400);
  }
  try {
    return json({ sha: await createBlob(githubToken(env), env.BLOG_REPO!, content) });
  } catch (error) {
    return failed(error, "Upload failed.");
  }
}

async function handleImages(request: Request, env: Env): Promise<Response> {
  const missing = unreachable(env);
  if (missing) {
    return misconfigured(missing, env);
  }
  if (await limited(env.SOURCE_RATE, request, "source")) {
    return tooMany();
  }
  const own = new URL(request.url).searchParams.getAll("own").slice(0, 4);
  const { imagesDir } = dirs(env);
  const branch = env.BLOG_BRANCH || "main";
  const token = githubToken(env);
  const served = servedDir(env).slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    const [files, texts, redirects] = await Promise.all([
      listFiles(token, env.BLOG_REPO!, branch, imagesDir),
      readTexts(token, env.BLOG_REPO!, branch, textDirs(env)),
      readTextFile(token, env.BLOG_REPO!, branch, REDIRECTS_PATH),
    ]);
    const shared = new Set<string>();
    for (const { path, text } of texts) {
      if (!own.includes(path)) {
        for (const [, file] of text.matchAll(new RegExp(`${served}([^\\s)"'<>?#]+)`, "g"))) {
          shared.add(stem(decoded(file)));
        }
      }
    }
    return json({
      files: files.map((file) => ({ ...file, shared: shared.has(stem(file.name)) })),
      redirected: redirectSources(redirects?.markdown ?? "").map((source) => decoded(source.split("/").pop()!)),
    });
  } catch (error) {
    return failed(error, "Read failed.");
  }
}

function postTime(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(?:(Z)|([+-])(\d{2}):?(\d{2}))?/.exec(value);
  if (!m) {
    return 0;
  }
  const [, y, mo, d, h = "0", mi = "0", sec = "0", zulu, sign = "+", oh = "07", om = "00"] = m;
  const offset = zulu ? 0 : (sign === "-" ? -1 : 1) * (Number(oh) * 60 + Number(om));
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec)) - offset * 60_000;
}

export function siteFile(path: string, text: string): SiteFile {
  const yaml = frontMatter(text)?.yaml ?? "";
  const written = frontField(yaml, "date")?.text ?? "";
  const named = fileDate(path);
  const pin = frontField(yaml, "pin");
  const hidden = frontField(yaml, "hidden");
  return {
    path,
    title: frontField(yaml, "title")?.text ?? "",
    date: named || /^\d{4}-\d{2}-\d{2}/.exec(written)?.[0] || "",
    time: postTime(written) || postTime(named),
    pin: pin ? readPin(pin.text, pin.plain) : false,
    hidden: Boolean(hidden?.plain && /^(?:true|True|TRUE)$/.test(hidden.text)),
  };
}

async function handleSite(request: Request, env: Env): Promise<Response> {
  const denied = await authorize(request, env);
  if (denied) {
    return denied;
  }
  if (await limited(env.SOURCE_RATE, request, "source")) {
    return tooMany();
  }
  const { postsDir, draftsDir } = dirs(env);
  const listed = (texts: { path: string; text: string }[]) =>
    texts
      .filter(({ path }) => MARKDOWN.test(path))
      .map(({ path, text }) => siteFile(path, text))
      .sort((a, b) => b.time - a.time || a.path.localeCompare(b.path));
  try {
    const texts = await readTexts(githubToken(env), env.BLOG_REPO!, env.BLOG_BRANCH || "main", [postsDir, draftsDir]);
    const files: SiteFiles = {
      posts: listed(texts.filter(({ path }) => path.startsWith(`${postsDir}/`))),
      drafts: listed(texts.filter(({ path }) => path.startsWith(`${draftsDir}/`))),
    };
    return json(files);
  } catch (error) {
    return failed(error, "Read failed.");
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
  const allowed = allowedDirs(env);
  if (!path || !allowed.some((dir) => path.startsWith(dir))) {
    return json({ error: `Path outside the allowed directories (${allowed.join(", ")}): ${requested}` }, 400);
  }
  if (await limited(env.SOURCE_RATE, request, "source")) {
    return tooMany();
  }
  if (!MARKDOWN.test(path)) {
    return json({ error: "Only Markdown files can be opened." }, 400);
  }

  const published = path.startsWith(`${dirs(env).postsDir}/`);
  if (published) {
    const missing = unreachable(env);
    if (missing) {
      return misconfigured(missing, env);
    }
  } else {
    const denied = await authorize(request, env);
    if (denied) {
      return denied;
    }
  }

  const branch = env.BLOG_BRANCH || "main";
  try {
    const file = await readTextFile(githubToken(env), env.BLOG_REPO!, branch, path);
    if (file === null) {
      return json({ error: await whyMissing(env, branch, path) }, 404);
    }
    return json({ path, branch, ...file });
  } catch (error) {
    return failed(error, "Read failed.");
  }
}

function passkeyStore(env: Env) {
  return env.PASSKEYS.get(env.PASSKEYS.idFromName("owner"));
}

async function readJsonObject(request: Request, max: number): Promise<Record<string, unknown> | null> {
  const raw = await readCapped(request, max);
  if (!raw) {
    return null;
  }
  try {
    const body = JSON.parse(new TextDecoder().decode(raw));
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function spender(env: Env, purpose: ChallengePurpose) {
  return async (challenge: string) => {
    const expires = await challengeExpiry(env.WRITE_PASSWORD!, purpose, challenge);
    return expires !== null && (await passkeyStore(env).spend(challenge, expires));
  };
}

async function handlePasskeyChallenge(request: Request, env: Env): Promise<Response> {
  if (crossSite(request)) {
    return json({ error: "Passkeys can only be used from the app itself." }, 403);
  }
  const missing = problem(env);
  if (missing) {
    return misconfigured(missing, env);
  }
  const purpose: ChallengePurpose = new URL(request.url).searchParams.get("for") === "register" ? "register" : "login";
  if (purpose === "register") {
    const denied = await authorize(request, env, { passwordOnly: true });
    if (denied) {
      return denied;
    }
  } else if (await limited(env.SOURCE_RATE, request, "passkey")) {
    return tooMany();
  }
  return json({
    challenge: await issueChallenge(env.WRITE_PASSWORD!, purpose),
    rpId: new URL(request.url).hostname,
    credentials: await passkeyStore(env).credentialIds(),
    algorithms: ALGORITHMS,
  });
}

async function handlePasskeyRegister(request: Request, env: Env): Promise<Response> {
  if (crossSite(request)) {
    return json({ error: "Passkeys can only be used from the app itself." }, 403);
  }
  const denied = await authorize(request, env, { passwordOnly: true });
  if (denied) {
    return denied;
  }
  const body = await readJsonObject(request, PASSKEY_BODY_BYTES);
  const id = fromBase64url(body?.id, 1024);
  const clientDataJSON = fromBase64url(body?.clientDataJSON);
  const authenticatorData = fromBase64url(body?.authenticatorData);
  const publicKey = fromBase64url(body?.publicKey);
  const alg = Number(body?.alg);
  if (!id?.length || !clientDataJSON || !authenticatorData || !publicKey || !ALGORITHMS.includes(alg as -7 | -257)) {
    return json({ error: "That is not a passkey the app can use." }, 400);
  }
  const url = new URL(request.url);
  const store = passkeyStore(env);
  const checked = await checkCeremony(clientDataJSON, authenticatorData, {
    type: "webauthn.create",
    origin: url.origin,
    rpId: url.hostname,
    consume: spender(env, "register"),
  });
  if (typeof checked === "string") {
    return json({ error: checked }, 400);
  }
  if (!checked.credentialId || base64url(checked.credentialId) !== base64url(id)) {
    return json({ error: "The passkey's response does not match it." }, 400);
  }
  if (!(await importKey(publicKey, alg))) {
    return json({ error: "That is not a passkey the app can use." }, 400);
  }
  if (!(await store.add(base64url(id), publicKey.slice().buffer, alg))) {
    return json({ error: "There are already as many passkeys as the app keeps." }, 400);
  }
  return json({ session: await issueSession(env.WRITE_PASSWORD!) });
}

async function handlePasskeyLogin(request: Request, env: Env): Promise<Response> {
  if (crossSite(request)) {
    return json({ error: "Passkeys can only be used from the app itself." }, 403);
  }
  const missing = problem(env);
  if (missing) {
    return misconfigured(missing, env);
  }
  if (await limited(env.SOURCE_RATE, request, "passkey")) {
    return tooMany();
  }
  const body = await readJsonObject(request, PASSKEY_BODY_BYTES);
  const id = typeof body?.id === "string" && fromBase64url(body.id, 1024) ? body.id : null;
  const clientDataJSON = fromBase64url(body?.clientDataJSON);
  const authenticatorData = fromBase64url(body?.authenticatorData);
  const signature = fromBase64url(body?.signature);
  if (!id || !clientDataJSON || !authenticatorData || !signature) {
    return json({ error: "That passkey could not be read." }, 400);
  }
  const store = passkeyStore(env);
  const credential = await store.credential(id);
  if (!credential) {
    return json({ error: "This passkey is not one the app knows. Sign in with the password and add it again." }, 401);
  }
  const url = new URL(request.url);
  const checked = await checkCeremony(clientDataJSON, authenticatorData, {
    type: "webauthn.get",
    origin: url.origin,
    rpId: url.hostname,
    consume: spender(env, "login"),
  });
  if (typeof checked === "string") {
    return json({ error: checked }, 401);
  }
  if (!(await verifySignature(credential, checked, signature))) {
    return json({ error: "The passkey's signature did not check out." }, 401);
  }
  if ((checked.counter !== 0 || credential.counter !== 0) && checked.counter <= credential.counter) {
    return json({ error: "This passkey looks copied. Sign in with the password." }, 401);
  }
  await store.touch(id, checked.counter);
  return json({ session: await issueSession(env.WRITE_PASSWORD!) });
}

function mediaBase(env: Env): string {
  return env.MEDIA && env.MEDIA_URL?.trim() ? env.MEDIA_URL.trim().replace(/\/+$/, "") : "";
}

const MEDIA_BODY_BYTES = 64 * 1024;
const VIDEO_CACHE = "public, max-age=31536000, immutable";
const POSTER_CACHE = "public, max-age=604800";
const UPLOAD_ID_LENGTH = 1024;

async function mediaGate(request: Request, env: Env): Promise<Response | { bucket: R2Bucket; base: string }> {
  const denied = await authorize(request, env);
  if (denied) {
    return denied;
  }
  const base = mediaBase(env);
  return base
    ? { bucket: env.MEDIA!, base }
    : json({ error: "Video uploads are not set up here: bind an R2 bucket as MEDIA and set MEDIA_URL to the address it is served from." }, 501);
}

function videoUses(texts: { path: string; text: string }[]): Map<string, string[]> {
  const uses = new Map<string, string[]>();
  for (const { path, text } of texts) {
    for (const key of videoKeysIn(text)) {
      uses.set(key, [...(uses.get(key) ?? []), path]);
    }
  }
  return uses;
}

const isVideoKey = (key: unknown): key is string => typeof key === "string" && VIDEO_KEY.test(key);

function readUses(env: Env): Promise<Map<string, string[]>> {
  return readTexts(githubToken(env), env.BLOG_REPO!, env.BLOG_BRANCH || "main", textDirs(env), MEDIA_DEPTH, [dirs(env).postsDir]).then(videoUses);
}

interface Sweep {
  candidates: string[];
  kept: Set<string>;
}

async function videosLeaving(env: Env, files: PublishFile[], remove: string[], retire: string[], keep: string[], fromOld: boolean): Promise<Sweep> {
  const decoder = new TextDecoder();
  const written = files.flatMap((file) =>
    "contentBase64" in file && MARKDOWN.test(file.path)
      ? [{ path: file.path, text: decoder.decode(Uint8Array.from(atob(file.contentBase64), (char) => char.charCodeAt(0))) }]
      : [],
  );
  const leaving = fromOld ? [...new Set([...written.map((file) => file.path), ...remove.filter((path) => MARKDOWN.test(path))])] : [];
  const before = await Promise.all(
    leaving.map((path) => readTextFile(githubToken(env), env.BLOG_REPO!, env.BLOG_BRANCH || "main", path)),
  );
  const kept = new Set([...keep, ...written.flatMap((file) => videoKeysIn(file.text))]);
  const candidates = new Set([...retire, ...before.flatMap((file) => (file ? videoKeysIn(file.markdown) : []))]);
  return { candidates: [...candidates].filter((key) => !kept.has(key)), kept };
}

async function removeUnused(env: Env, sweep: Sweep): Promise<string[]> {
  const uses = await readUses(env);
  const unused = sweep.candidates.filter((key) => !uses.has(key) && !sweep.kept.has(key));
  return unused.length ? deleteVideos(env.MEDIA!, unused) : [];
}

async function deleteVideos(bucket: R2Bucket, keys: string[]): Promise<string[]> {
  await bucket.delete(keys.flatMap((key) => [key, posterKey(key, "webp"), posterKey(key, "jpg")]));
  return keys;
}

async function listVideos(bucket: R2Bucket): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const listed = await bucket.list({ prefix: "video/", cursor, limit: 1000 });
    objects.push(...listed.objects);
    if (!listed.truncated) {
      break;
    }
    cursor = listed.cursor;
  }
  return objects;
}

async function handleMediaList(request: Request, env: Env): Promise<Response> {
  const gate = await mediaGate(request, env);
  if (gate instanceof Response) {
    return gate;
  }
  try {
    const [objects, uses] = await Promise.all([listVideos(gate.bucket), readUses(env)]);
    const names = new Set(objects.map((object) => object.key));
    const videos: MediaVideo[] = objects
      .filter((object) => VIDEO_KEY.test(object.key))
      .map((object) => {
        const poster = ["webp", "jpg"].map((extension) => posterKey(object.key, extension)).find((key) => names.has(key));
        return {
          key: object.key,
          url: `${gate.base}/${object.key}`,
          size: object.size,
          uploaded: object.uploaded.getTime(),
          poster: poster ? `${gate.base}/${poster}` : null,
          used: uses.get(object.key) ?? [],
        };
      })
      .sort((a, b) => b.uploaded - a.uploaded);
    return json({ videos });
  } catch (error) {
    return failed(error, "Could not read the videos.");
  }
}

async function handleMediaFetch(request: Request, env: Env): Promise<Response> {
  const gate = await mediaGate(request, env);
  if (gate instanceof Response) {
    return gate;
  }
  const url = new URL(request.url).searchParams.get("url") ?? "";
  if (!isDropbox(url)) {
    return json({ error: "Only a Dropbox share link can be fetched." }, 400);
  }
  try {
    const upstream = await fetch(dropboxFile(url));
    const type = upstream.headers.get("content-type") ?? "";
    const size = Number(upstream.headers.get("content-length") ?? "0");
    if (!upstream.ok || !upstream.body) {
      return json({ error: `Dropbox answered ${upstream.status}: is the link still shared?` }, 502);
    }
    if (!type.startsWith("video/") || size > MAX_VIDEO_BYTES) {
      await upstream.body.cancel();
      return json({ error: type.startsWith("video/") ? `This video is too large (max ${MAX_VIDEO_BYTES / 1024 ** 3} GB).` : "That link is not a video." }, 400);
    }
    let sent = 0;
    const capped = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        sent += chunk.byteLength;
        if (sent > MAX_VIDEO_BYTES) {
          controller.error(new Error("This video is too large."));
        } else {
          controller.enqueue(chunk);
        }
      },
    });
    return new Response(upstream.body.pipeThrough(capped), {
      headers: { "content-type": type, "cache-control": "no-store", ...(size ? { "content-length": String(size) } : {}) },
    });
  } catch (error) {
    return failed(error, "Could not reach Dropbox.");
  }
}

async function handleMediaDelete(request: Request, env: Env): Promise<Response> {
  const gate = await mediaGate(request, env);
  if (gate instanceof Response) {
    return gate;
  }
  const keys = (await readJsonObject(request, MEDIA_BODY_BYTES))?.keys;
  if (!validList(keys, isVideoKey) || !keys.length) {
    return json({ error: "Malformed videos to delete (at most 50 at a time)." }, 400);
  }
  try {
    const uses = await readUses(env);
    const free = keys.filter((key) => !uses.has(key));
    const deleted = free.length ? await deleteVideos(gate.bucket, free) : [];
    return json({ deleted, kept: keys.filter((key) => uses.has(key)).map((key) => ({ key, used: uses.get(key)! })) });
  } catch (error) {
    return failed(error, "Could not delete the videos.");
  }
}

function uploadOf(key: unknown, upload: unknown): { key: string; upload: string } | null {
  return typeof key === "string" && VIDEO_KEY.test(key) && typeof upload === "string" && upload.length > 0 && upload.length <= UPLOAD_ID_LENGTH
    ? { key, upload }
    : null;
}

async function handleMediaStart(request: Request, env: Env): Promise<Response> {
  const gate = await mediaGate(request, env);
  if (gate instanceof Response) {
    return gate;
  }
  const body = await readJsonObject(request, MEDIA_BODY_BYTES);
  const fingerprint = typeof body?.fingerprint === "string" && /^[0-9a-f]{64}$/.test(body.fingerprint) ? body.fingerprint : null;
  const type = typeof body?.type === "string" ? body.type : "";
  const extension = VIDEO_TYPES[type];
  const size = Number(body?.size);
  if (!fingerprint || !extension || !Number.isSafeInteger(size) || size <= 0) {
    return json({ error: "Malformed video upload." }, 400);
  }
  if (size > MAX_VIDEO_BYTES) {
    return json({ error: `This video is too large to upload (max ${MAX_VIDEO_BYTES / 1024 ** 3} GB).` }, 400);
  }
  const key = videoKey(typeof body?.name === "string" ? body.name : "", fingerprint, extension);
  const url = `${gate.base}/${key}`;
  try {
    const kept = await gate.bucket.head(key);
    if (kept?.customMetadata?.fingerprint === fingerprint) {
      return json({ key, url } satisfies MediaStart);
    }
    const upload = await gate.bucket.createMultipartUpload(key, {
      httpMetadata: { contentType: type, cacheControl: VIDEO_CACHE },
      customMetadata: { fingerprint },
    });
    return json({ key, url, upload: upload.uploadId } satisfies MediaStart);
  } catch (error) {
    return failed(error, "Could not start the upload.");
  }
}

async function handleMediaPart(request: Request, env: Env): Promise<Response> {
  const gate = await mediaGate(request, env);
  if (gate instanceof Response) {
    return gate;
  }
  const params = new URL(request.url).searchParams;
  const target = uploadOf(params.get("key"), params.get("upload"));
  const part = Number(params.get("part"));
  if (!target || !Number.isInteger(part) || part < 1 || part > 10_000) {
    return json({ error: "Malformed video part." }, 400);
  }
  const bytes = await readCapped(request, PART_BYTES);
  if (!bytes?.byteLength) {
    return json({ error: `A part of a video is ${PART_BYTES / 1024 / 1024} MB at most, and not empty.` }, 400);
  }
  try {
    const sent = await gate.bucket.resumeMultipartUpload(target.key, target.upload).uploadPart(part, bytes);
    return json({ partNumber: sent.partNumber, etag: sent.etag } satisfies MediaPart);
  } catch (error) {
    return failed(error, "Could not send part of the video.");
  }
}

const isPart = (value: unknown): value is MediaPart =>
  typeof value === "object" &&
  value !== null &&
  Number.isInteger((value as MediaPart).partNumber) &&
  typeof (value as MediaPart).etag === "string" &&
  (value as MediaPart).etag.length <= 256;

async function handleMediaComplete(request: Request, env: Env): Promise<Response> {
  const gate = await mediaGate(request, env);
  if (gate instanceof Response) {
    return gate;
  }
  const body = await readJsonObject(request, MEDIA_BODY_BYTES);
  const target = uploadOf(body?.key, body?.upload);
  const parts = body?.parts;
  if (!target || !Array.isArray(parts) || !parts.length || parts.length > 10_000 || !parts.every(isPart)) {
    return json({ error: "Malformed upload to finish." }, 400);
  }
  try {
    const object = await gate.bucket
      .resumeMultipartUpload(target.key, target.upload)
      .complete(parts.map(({ partNumber, etag }) => ({ partNumber, etag })));
    return json({ key: target.key, url: `${gate.base}/${target.key}`, size: object.size });
  } catch (error) {
    return failed(error, "Could not finish the upload.");
  }
}

async function handleMediaAbort(request: Request, env: Env): Promise<Response> {
  const gate = await mediaGate(request, env);
  if (gate instanceof Response) {
    return gate;
  }
  const body = await readJsonObject(request, MEDIA_BODY_BYTES);
  const target = uploadOf(body?.key, body?.upload);
  if (!target) {
    return json({ error: "Malformed upload to stop." }, 400);
  }
  try {
    await gate.bucket.resumeMultipartUpload(target.key, target.upload).abort();
    return json({ ok: true });
  } catch (error) {
    return failed(error, "Could not stop the upload.");
  }
}

async function handleMediaPoster(request: Request, env: Env): Promise<Response> {
  const gate = await mediaGate(request, env);
  if (gate instanceof Response) {
    return gate;
  }
  const key = new URL(request.url).searchParams.get("key") ?? "";
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  const extension = POSTER_TYPES[type];
  if (!VIDEO_KEY.test(key) || !extension) {
    return json({ error: "Malformed video still." }, 400);
  }
  const bytes = await readCapped(request, MAX_POSTER_BYTES);
  if (!bytes?.byteLength) {
    return json({ error: `A video's still is ${MAX_POSTER_BYTES / 1024 / 1024} MB at most, and not empty.` }, 400);
  }
  const target = posterKey(key, extension);
  try {
    await gate.bucket.put(target, bytes, { httpMetadata: { contentType: type, cacheControl: POSTER_CACHE } });
    return json({ key: target, url: `${gate.base}/${target}` });
  } catch (error) {
    return failed(error, "Could not upload the video's still.");
  }
}

function randomHex(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
  const token = randomHex();
  const owner = randomHex();
  const room = env.SHARE.get(env.SHARE.idFromName(token));
  const seeded = await room.fetch("https://share/seed", { method: "POST", body: seed, headers: { "x-share-owner": owner } });
  if (seeded.status === 400) {
    return json({ error: "That is not a draft the app can share." }, 400);
  }
  if (!seeded.ok) {
    return json({ error: "Could not start the share." }, 500);
  }
  return json({ token, owner });
}

async function handleShareRoom(request: Request, env: Env, token: string): Promise<Response> {
  const room = env.SHARE.get(env.SHARE.idFromName(token));
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return room.fetch(request);
  }
  if (request.method === "DELETE") {
    if (crossSite(request)) {
      return json({ error: "Shares can only be managed from the app itself." }, 403);
    }
    return room.fetch("https://share/", { method: "DELETE", headers: { "x-share-owner": request.headers.get("x-share-owner") ?? "" } });
  }
  if (request.method === "GET") {
    return room.fetch("https://share/", { method: "GET" });
  }
  return json({ error: "Use GET, DELETE, or a WebSocket." }, 405);
}

type Handler = (request: Request, env: Env) => Response | Promise<Response>;

const ROUTES = new Map<string, [method: "GET" | "POST" | "PUT", handle: Handler]>([
  ["/api/config", ["GET", (_request, env) => handleConfig(env)]],
  ["/api/share", ["POST", handleShareCreate]],
  ["/api/publish", ["POST", handlePublish]],
  ["/api/publish/photo", ["POST", handlePhoto]],
  ["/api/images", ["GET", handleImages]],
  ["/api/site", ["GET", handleSite]],
  ["/api/source", ["GET", handleSource]],
  ["/api/passkey/challenge", ["POST", handlePasskeyChallenge]],
  ["/api/passkey/register", ["POST", handlePasskeyRegister]],
  ["/api/passkey/login", ["POST", handlePasskeyLogin]],
  ["/api/topics", ["GET", (_request, env) => handleTopics(env)]],
  ["/api/media", ["GET", handleMediaList]],
  ["/api/media/delete", ["POST", handleMediaDelete]],
  ["/api/media/fetch", ["GET", handleMediaFetch]],
  ["/api/media/start", ["POST", handleMediaStart]],
  ["/api/media/part", ["PUT", handleMediaPart]],
  ["/api/media/complete", ["POST", handleMediaComplete]],
  ["/api/media/abort", ["POST", handleMediaAbort]],
  ["/api/media/poster", ["PUT", handleMediaPoster]],
]);

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const share = SHARE_PATH.exec(pathname);
  if (share) {
    return handleShareRoom(request, env, share[1]);
  }
  const known = ROUTES.get(pathname);
  if (known) {
    const [method, handle] = known;
    return request.method === method ? handle(request, env) : json({ error: `Use ${method}.` }, 405);
  }
  if (pathname.startsWith("/api/")) {
    return json({ error: "Not found." }, 404);
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return secured(await route(request, env));
  },
} satisfies ExportedHandler<Env>;
