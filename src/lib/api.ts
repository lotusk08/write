import type {
  AppConfig,
  PublishRequest,
  PublishResult,
  SiteFiles,
  SitePhoto,
  Topic,
  Topics,
} from "../../shared/types.ts";
import { MAX_VIDEO_BYTES, type MediaPart, type MediaStart, type MediaVideo } from "../../shared/media.ts";
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
    throw new HttpError(payload.error || `${whenItFails} (${response.status}).`, response.status);
  }
  return payload as T;
}

function answeredJson(response: Response): boolean {
  return response.ok && (response.headers.get("content-type") ?? "").includes("application/json");
}

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

type SitePhotos = { files: SitePhoto[]; redirected: string[] };

const PHOTOS_TTL_MS = 60_000;
const photosRead = new Map<string, { at: number; read: Promise<SitePhotos> }>();

export function fetchSitePhotos(own: string[]): Promise<SitePhotos> {
  const query = new URLSearchParams(own.map((path) => ["own", path])).toString();
  const kept = photosRead.get(query);
  if (kept && Date.now() - kept.at < PHOTOS_TTL_MS) {
    return kept.read;
  }
  const read = (async () => {
    const response = await fetch(`/api/images?${query}`, { headers: { accept: "application/json" } });
    const result = await readJson<{ files?: SitePhoto[]; redirected?: string[] }>(response, "Could not read the site's photos");
    return {
      files: Array.isArray(result.files) ? result.files : [],
      redirected: Array.isArray(result.redirected) ? result.redirected : [],
    };
  })();
  photosRead.set(query, { at: Date.now(), read });
  read.catch(() => photosRead.delete(query));
  return read;
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

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

async function mediaJson<T>(path: string, body: unknown, password: string, whenItFails: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: headers(password, { "content-type": "application/json" }),
    body: JSON.stringify(body),
    signal,
  });
  if (response.status >= 500) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new HttpError(payload.error || `${whenItFails} (${response.status}).`, response.status);
  }
  return readJson<T>(response, whenItFails);
}

export async function fetchMediaVideos(password: string): Promise<MediaVideo[]> {
  const response = await fetch("/api/media", { headers: headers(password) });
  const result = await readJson<{ videos?: MediaVideo[] }>(response, "Could not read the videos");
  return Array.isArray(result.videos) ? result.videos : [];
}

export function deleteMediaVideos(keys: string[], password: string): Promise<{ deleted: string[]; kept: { key: string; used: string[] }[] }> {
  return mediaJson("/api/media/delete", { keys }, password, "Could not delete the videos");
}

export async function fetchDropboxVideo(
  url: string,
  password: string,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
  onAuthorized: () => void = () => {},
): Promise<File> {
  const response = await fetch(`/api/media/fetch?${new URLSearchParams({ url })}`, { headers: headers(password), signal });
  if (!response.ok || !response.body) {
    await readJson(response, "Could not fetch the video from Dropbox");
    throw new Error("Could not fetch the video from Dropbox.");
  }
  onAuthorized();
  const total = Number(response.headers.get("content-length") ?? "0");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    loaded += value.byteLength;
    if (loaded > MAX_VIDEO_BYTES) {
      await reader.cancel();
      throw new Error(`This video is too large (max ${MAX_VIDEO_BYTES / 1024 ** 3} GB).`);
    }
    if (total) {
      onProgress(loaded / total);
    }
  }
  const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "video");
  return new File(chunks as BlobPart[], name, { type: response.headers.get("content-type") ?? "" });
}

export function startMedia(
  video: { name: string; fingerprint: string; size: number; type: string },
  password: string,
  signal?: AbortSignal,
): Promise<MediaStart> {
  return mediaJson<MediaStart>("/api/media/start", video, password, "Could not start the upload", signal);
}

export function completeMedia(key: string, upload: string, parts: MediaPart[], password: string, signal?: AbortSignal): Promise<{ url: string }> {
  return mediaJson("/api/media/complete", { key, upload, parts }, password, "Could not finish the upload", signal);
}

export async function abortMedia(key: string, upload: string, password: string): Promise<void> {
  await mediaJson("/api/media/abort", { key, upload }, password, "Could not stop the upload");
}

function put<T>(path: string, body: Blob, password: string, type: string, signal: AbortSignal, onSent: (bytes: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const xhr = new XMLHttpRequest();
    const stop = () => xhr.abort();
    xhr.open("PUT", path);
    for (const [name, value] of Object.entries(headers(password, { "content-type": type }))) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => onSent(event.loaded);
    xhr.onload = () => {
      signal.removeEventListener("abort", stop);
      let payload: { error?: string } = {};
      try {
        payload = JSON.parse(xhr.responseText) as { error?: string };
      } catch {
      }
      if (xhr.status === 401) {
        reject(new PasswordRejected(payload.error || "Wrong password."));
      } else if (xhr.status < 200 || xhr.status >= 300) {
        reject(new HttpError(payload.error || `The upload was refused (${xhr.status}).`, xhr.status));
      } else {
        resolve(payload as T);
      }
    };
    xhr.onerror = () => {
      signal.removeEventListener("abort", stop);
      reject(new Error("The connection dropped while sending the video."));
    };
    xhr.onabort = () => reject(signal.reason ?? new DOMException("The upload was stopped.", "AbortError"));
    signal.addEventListener("abort", stop, { once: true });
    xhr.send(body);
  });
}

export function sendMediaPart(
  key: string,
  upload: string,
  part: number,
  body: Blob,
  password: string,
  signal: AbortSignal,
  onSent: (bytes: number) => void,
): Promise<MediaPart> {
  const query = new URLSearchParams({ key, upload, part: String(part) });
  return put<MediaPart>(`/api/media/part?${query}`, body, password, "application/octet-stream", signal, onSent);
}

export function uploadPoster(key: string, poster: Blob, password: string, signal: AbortSignal): Promise<{ url: string }> {
  return put(`/api/media/poster?${new URLSearchParams({ key })}`, poster, password, poster.type, signal, () => undefined);
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
  photosRead.clear();
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
