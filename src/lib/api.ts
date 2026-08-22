import { commitFiles } from "../../shared/github.ts";
import type { AppConfig, PublishRequest, PublishResult } from "../../shared/types.ts";
import type { Settings } from "./settings.ts";

/**
 * Asks the worker how this deployment is configured. Returns null when the app
 * is served as plain static files (no worker), in which case publishing falls
 * back to a token kept in the browser.
 */
export async function fetchAppConfig(): Promise<AppConfig | null> {
  try {
    const response = await fetch("/api/config", { headers: { accept: "application/json" } });
    if (!response.ok) {
      return null;
    }
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("application/json")) {
      return null;
    }
    return (await response.json()) as AppConfig;
  } catch {
    return null;
  }
}

export function usesServerPublishing(config: AppConfig | null): boolean {
  return config?.publishMode === "server";
}

async function publishViaWorker(
  request: PublishRequest,
  password: string,
): Promise<PublishResult> {
  const response = await fetch("/api/publish", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(password ? { "x-write-password": password } : {}),
    },
    body: JSON.stringify(request),
  });

  const payload = (await response.json().catch(() => ({}))) as Partial<PublishResult> & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Publish failed (${response.status}).`);
  }
  return payload as PublishResult;
}

export async function publish(
  request: PublishRequest,
  config: AppConfig | null,
  settings: Settings,
): Promise<PublishResult> {
  if (usesServerPublishing(config)) {
    return publishViaWorker(request, settings.writePassword);
  }

  if (!settings.githubToken) {
    throw new Error(
      "No GitHub token yet. Add a fine-grained token in Settings, or deploy the worker with a GITHUB_TOKEN secret so the token never touches the browser.",
    );
  }

  return commitFiles({
    token: settings.githubToken,
    repo: settings.repo,
    branch: request.branch || settings.branch,
    baseBranch: settings.branch,
    message: request.message,
    files: request.files,
    pullRequest: request.pullRequest ?? null,
  });
}
