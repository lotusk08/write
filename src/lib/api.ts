import { commitFiles, readTextFile } from "../../shared/github.ts";
import type { PublishRequest, PublishResult } from "../../shared/types.ts";
import type { Settings } from "./settings.ts";

/**
 * The blog is reached straight from the browser with fine-grained tokens.
 *
 * There is nothing of this app's own running anywhere — it is static files —
 * so the tokens in Settings are all the trust it holds, and they are split by
 * what they can do. Reading a post back needs Contents: read, and that token
 * sits in this browser: the posts it can reach are published anyway. Writing
 * needs Contents: read and write, and that one is locked (see `lock.ts`) and
 * opened with a passphrase at the moment of publishing.
 */

export interface PostSource {
  path: string;
  branch: string;
  markdown: string;
}

function readToken(settings: Settings): string {
  if (!settings.githubToken) {
    throw new Error(
      "No read token yet. Add a fine-grained one — Contents: read on the blog repo — in Settings.",
    );
  }
  return settings.githubToken;
}

/** Reads a published post back out of the repository, for `?edit=`. */
export async function fetchPostSource(path: string, settings: Settings): Promise<PostSource> {
  const markdown = await readTextFile(readToken(settings), settings.repo, settings.branch, path);
  if (markdown === null) {
    throw new Error(`${settings.repo} has no ${path} on ${settings.branch}.`);
  }
  return { path, branch: settings.branch, markdown };
}

/** `writeToken` is the unlocked publish token, held for this tab only. */
export async function publish(
  request: PublishRequest,
  settings: Settings,
  writeToken: string,
): Promise<PublishResult> {
  return commitFiles({
    token: writeToken,
    repo: settings.repo,
    branch: request.branch || settings.branch,
    baseBranch: settings.branch,
    message: request.message,
    files: request.files,
    pullRequest: request.pullRequest ?? null,
  });
}
