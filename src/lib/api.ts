import type {
  AppConfig,
  PublishRequest,
  PublishResult,
  Topic,
  Topics,
} from "../../shared/types.ts";

export class PasswordRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordRejected";
  }
}

function headers(password: string, extra?: Record<string, string>): Record<string, string> {
  return {
    accept: "application/json",
    ...(password ? { "x-write-password": password } : {}),
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

export async function fetchAppConfig(): Promise<AppConfig | null> {
  try {
    const response = await fetch("/api/config", { headers: { accept: "application/json" } });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) {
      return null;
    }
    return (await response.json()) as AppConfig;
  } catch {
    return null;
  }
}

const NO_TOPICS: Topics = { tags: [], categories: [] };

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
      if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) {
        throw new Error("No topics.");
      }
      const body = (await response.json()) as Partial<Record<keyof Topics, unknown>>;
      const found = { tags: topicList(body.tags), categories: topicList(body.categories) };
      if (!found.tags.length && !found.categories.length) {
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

export async function createShareRoom(seed: Uint8Array): Promise<string> {
  const response = await fetch("/api/share", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/octet-stream" },
    body: seed as unknown as BodyInit,
  });
  const result = await readJson<{ token?: string }>(response, "Could not start sharing");
  if (!result.token) {
    throw new Error("Could not start sharing.");
  }
  return result.token;
}

export async function endShareRoom(token: string): Promise<void> {
  const response = await fetch(`/api/share/${encodeURIComponent(token)}`, {
    method: "DELETE",
    headers: { accept: "application/json" },
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
