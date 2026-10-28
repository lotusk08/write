import type {
  AppConfig,
  PublishRequest,
  PublishResult,
  SiteFiles,
  SitePhoto,
  Topic,
  Topics,
} from "../../shared/types.ts";
import { sessionToken } from "./password.ts";

export class PasswordRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordRejected";
  }
}

function headers(password: string, extra?: Record<string, string>): Record<string, string> {
  const session = sessionToken();
  return {
    accept: "application/json",
    ...(password ? { "x-write-password": password } : {}),
    ...(session ? { "x-write-session": session } : {}),
    ...extra,
  };
}

async function readJson<T>(response: Response, whenItFails: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as Partial<T> & { error?: string };
  if (response.status === 401) {
    throw new PasswordRejected(payload.error || "Wrong password.");
  }
  if (!response.ok) {
    throw new Error(payload.error || `${whenItFails} (${response.status}).`);
  }
  return payload as T;
}

/** Whether the Worker answered: under `npm run dev` there is no `/api`, and Vite hands back the page instead. */
function answeredJson(response: Response): boolean {
  return response.ok && (response.headers.get("content-type") ?? "").includes("application/json");
}

/** How long the drafts wait on the Worker at startup; past it, they open without its settings. */
const CONFIG_WAIT_MS = 6000;

export async function fetchAppConfig(): Promise<AppConfig | null> {
  try {
    const response = await fetch("/api/config", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(CONFIG_WAIT_MS) });
    if (!answeredJson(response)) {
      return null;
    }
    return (await response.json()) as AppConfig;
  } catch {
    return null;
  }
}

const NO_TOPICS: Topics = { tags: [] };

let topics: Promise<Topics> | null = null;

function topicList(value: unknown): Topic[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (topic): topic is Topic =>
      typeof topic?.title === "string" &&
      typeof topic?.slug === "string" &&
      typeof topic?.count === "number",
  );
}

export function fetchTopics(): Promise<Topics> {
  topics ??= fetch("/api/topics", { headers: { accept: "application/json" } })
    .then(async (response) => {
      if (!answeredJson(response)) {
        throw new Error("No topics.");
      }
      const body = (await response.json()) as Partial<Record<keyof Topics, unknown>>;
      const found = { tags: topicList(body.tags) };
      if (!found.tags.length) {
        throw new Error("No topics.");
      }
      return found;
    })
    .catch(() => {
      topics = null;
      return NO_TOPICS;
    });
  return topics;
}

export interface PostSource {
  path: string;
  branch: string;
  markdown: string;
  sha: string;
}

export async function fetchPostSource(path: string, password: string): Promise<PostSource> {
  const response = await fetch(`/api/source?path=${encodeURIComponent(path)}`, {
    headers: headers(password),
  });
  const source = await readJson<PostSource>(response, `Could not open ${path}`);
  if (typeof source.markdown !== "string") {
    throw new Error(`Could not open ${path}.`);
  }
  return source;
}

export async function fetchSiteFiles(password: string): Promise<SiteFiles> {
  const response = await fetch("/api/site", { headers: headers(password) });
  const result = await readJson<Partial<SiteFiles>>(response, "Could not read the site's posts and drafts");
  return {
    posts: Array.isArray(result.posts) ? result.posts : [],
    drafts: Array.isArray(result.drafts) ? result.drafts : [],
  };
}

export async function fetchSitePhotos(own: string[]): Promise<{ files: SitePhoto[]; redirected: string[] }> {
  const query = new URLSearchParams(own.map((path) => ["own", path]));
  const response = await fetch(`/api/images?${query}`, { headers: { accept: "application/json" } });
  const result = await readJson<{ files?: SitePhoto[]; redirected?: string[] }>(response, "Could not read the site's photos");
  return {
    files: Array.isArray(result.files) ? result.files : [],
    redirected: Array.isArray(result.redirected) ? result.redirected : [],
  };
}

export async function uploadPhoto(contentBase64: string, password: string, signal?: AbortSignal): Promise<string> {
  let status = 0;
  const send = async () => {
    status = 0;
    const response = await fetch("/api/publish/photo", {
      method: "POST",
      headers: headers(password, { "content-type": "text/plain" }),
      body: contentBase64,
      signal,
    });
    status = response.status;
    const result = await readJson<{ sha?: string }>(response, "Could not upload a photo");
    if (!result.sha) {
      throw new Error("Could not upload a photo.");
    }
    return result.sha;
  };
  return send().catch((cause: unknown) => {
    if ((status >= 400 && status < 500) || signal?.aborted) {
      throw cause;
    }
    return send();
  });
}

export async function createShareRoom(seed: Uint8Array): Promise<{ token: string; owner: string }> {
  const response = await fetch("/api/share", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/octet-stream" },
    body: seed as unknown as BodyInit,
  });
  const result = await readJson<{ token?: string; owner?: string }>(response, "Could not start sharing");
  if (!result.token || !result.owner) {
    throw new Error("Could not start sharing.");
  }
  return { token: result.token, owner: result.owner };
}

export async function endShareRoom(token: string, owner: string | boolean | undefined): Promise<void> {
  const response = await fetch(`/api/share/${encodeURIComponent(token)}`, {
    method: "DELETE",
    headers: { accept: "application/json", ...(typeof owner === "string" ? { "x-share-owner": owner } : {}) },
  });
  if (!response.ok && response.status !== 404) {
    await readJson(response, "Could not stop sharing");
  }
}

export type ShareRoomState = "live" | "ended" | "unknown";

export async function shareRoomState(token: string): Promise<ShareRoomState> {
  try {
    const response = await fetch(`/api/share/${encodeURIComponent(token)}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return "unknown";
    }
    return ((await response.json()) as { live?: boolean }).live ? "live" : "ended";
  } catch {
    return "unknown";
  }
}

export async function publish(
  request: PublishRequest,
  password: string,
): Promise<PublishResult> {
  const response = await fetch("/api/publish", {
    method: "POST",
    headers: headers(password, { "content-type": "application/json" }),
    body: JSON.stringify(request),
  });
  return readJson<PublishResult>(response, "Publish failed");
}

export interface PasskeyChallenge {
  challenge: string;
  rpId: string;
  credentials: string[];
  algorithms: number[];
}

/** A challenge to sign in with a passkey, or to save one, which takes the password. */
export async function passkeyChallenge(purpose: "login" | "register", password = ""): Promise<PasskeyChallenge> {
  const response = await fetch(`/api/passkey/challenge${purpose === "register" ? "?for=register" : ""}`, {
    method: "POST",
    headers: headers(purpose === "register" ? password : "", {}),
  });
  return readJson<PasskeyChallenge>(response, "Could not start the passkey");
}

async function passkeySession(path: string, body: Record<string, unknown>, password = ""): Promise<string> {
  const response = await fetch(path, {
    method: "POST",
    headers: headers(password, { "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  const result = await readJson<{ session?: string }>(response, "The passkey did not work");
  if (!result.session) {
    throw new Error("The passkey did not work.");
  }
  return result.session;
}

export function passkeyRegister(body: Record<string, unknown>, password: string): Promise<string> {
  return passkeySession("/api/passkey/register", body, password);
}

export function passkeyLogin(body: Record<string, unknown>): Promise<string> {
  return passkeySession("/api/passkey/login", body);
}
