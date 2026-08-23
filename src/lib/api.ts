import type { AppConfig, PublishRequest, PublishResult } from "../../shared/types.ts";

/**
 * The blog is reached through this app's own Worker, which holds the one token
 * that can read and write it. No GitHub credential ever reaches this browser.
 *
 * What does reach it is a password, sent as a header on these calls. It is
 * typed once and remembered, so publishing does not ask again — the Worker is
 * the thing that has to be convinced, not this browser, and it will say so with
 * a 401 if the password stops being right.
 */

/** A 401 from the Worker: the password is missing or no longer the one it has. */
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

/**
 * Asks the Worker how this deployment is configured. A `problem` in the answer
 * is something to fix on the deployment, not in the browser, so it is shown as
 * it is rather than translated. Needs no password: it says what is missing, not
 * what is in the repository.
 */
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

/** Reads a published post back out of the repository, for `?edit=`. */
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

/** Commits a post and its images in one go. */
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
