import type { AppConfig, PublishRequest, PublishResult } from "../../shared/types.ts";

/**
 * The blog is reached through this app's own Worker, which holds the one token
 * that can read and write it.
 *
 * Nothing here carries a credential. Cloudflare Access sits in front of the
 * hostname and signs you in; the browser gets a session cookie for it and sends
 * it with these requests the way it sends any cookie. So there is no token in
 * this browser to leak and no password to type per post — signing out of Access,
 * or letting the session lapse, is what takes the ability to publish away.
 */

async function readJson<T>(response: Response, whenItFails: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as Partial<T> & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `${whenItFails} (${response.status}).`);
  }
  return payload as T;
}

/**
 * Asks the Worker how this deployment is configured. A `problem` in the answer
 * is something to fix on the deployment, not in the browser, so it is shown as
 * it is rather than translated.
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
export async function fetchPostSource(path: string): Promise<PostSource> {
  const response = await fetch(`/api/source?path=${encodeURIComponent(path)}`, {
    headers: { accept: "application/json" },
  });
  const source = await readJson<PostSource>(response, `Could not open ${path}`);
  if (typeof source.markdown !== "string") {
    throw new Error(`Could not open ${path}.`);
  }
  return source;
}

/** Commits a post and its images in one go. */
export async function publish(request: PublishRequest): Promise<PublishResult> {
  const response = await fetch("/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(request),
  });
  return readJson<PublishResult>(response, "Publish failed");
}
