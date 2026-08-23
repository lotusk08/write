import { commitFiles, readTextFile } from "../../shared/github.ts";
import type { PublishRequest, PublishResult } from "../../shared/types.ts";
import type { Settings } from "./settings.ts";

/**
 * The blog is reached straight from the browser with a fine-grained token.
 *
 * There is nothing of this app's own running anywhere: it is a page and a
 * service worker's worth of static files, and the token in Settings is the one
 * piece of trust it holds. That token never leaves this browser, and it is the
 * only thing standing between it and the repository — so scope it to the blog
 * repo, Contents: read and write, and nothing else.
 */

export interface PostSource {
  path: string;
  branch: string;
  markdown: string;
}

function token(settings: Settings): string {
  if (!settings.githubToken) {
    throw new Error(
      "No GitHub token yet. Add a fine-grained one — Contents: read and write on the blog repo — in Settings.",
    );
  }
  return settings.githubToken;
}

/** Reads a published post back out of the repository, for `?edit=`. */
export async function fetchPostSource(path: string, settings: Settings): Promise<PostSource> {
  const markdown = await readTextFile(token(settings), settings.repo, settings.branch, path);
  if (markdown === null) {
    throw new Error(`${settings.repo} has no ${path} on ${settings.branch}.`);
  }
  return { path, branch: settings.branch, markdown };
}

export async function publish(
  request: PublishRequest,
  settings: Settings,
): Promise<PublishResult> {
  return commitFiles({
    token: token(settings),
    repo: settings.repo,
    branch: request.branch || settings.branch,
    baseBranch: settings.branch,
    message: request.message,
    files: request.files,
    pullRequest: request.pullRequest ?? null,
  });
}
