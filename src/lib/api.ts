import type { AppConfig, PublishRequest, PublishResult } from "../../shared/types.ts";

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

export async function createShareRoom(seed: Uint8Array, password: string): Promise<string> {
  const response = await fetch("/api/share", {
    method: "POST",
    headers: headers(password, { "content-type": "application/octet-stream" }),
    body: seed as unknown as BodyInit,
  });
  const result = await readJson<{ token?: string }>(response, "Could not start sharing");
  if (!result.token) {
    throw new Error("Could not start sharing.");
  }
  return result.token;
}

export async function endShareRoom(token: string, password: string): Promise<void> {
  const response = await fetch(`/api/share/${encodeURIComponent(token)}`, {
    method: "DELETE",
    headers: headers(password),
  });
  if (!response.ok && response.status !== 404) {
    await readJson(response, "Could not stop sharing");
  }
}

export async function shareRoomLive(token: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/share/${encodeURIComponent(token)}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return false;
    }
    return Boolean(((await response.json()) as { live?: boolean }).live);
  } catch {
    return false;
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
