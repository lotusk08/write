/**
 * Types and helpers with no DOM in them, kept apart from the editor so they can
 * be read — and tested — on their own, and shared with the Worker that holds
 * the blog's token.
 */

/**
 * How this deployment is configured, as the Worker sees it. The editor asks
 * once at startup: the repository, branch and directories are the deployment's
 * to know, not something to be re-typed into every browser.
 */
export interface AppConfig {
  repo: string;
  branch: string;
  /** Public site URL, used to preview images already published. */
  siteUrl: string;
  postsDir: string;
  draftsDir: string;
  imagesDir: string;
  /** False when something is missing and publishing would fail. */
  ready: boolean;
  /** What is missing, when it is not ready. */
  problem?: string;
}

/** Jekyll (Chirpy) front matter for a post. */
export interface PostMeta {
  title: string;
  description: string;
  author: string;
  /** `YYYY-MM-DD HH:mm:ss +ZZZZ`, the format the blog already uses. */
  date: string;
  categories: string[];
  tags: string[];
  pin: boolean;
  toc: boolean;
  math: boolean;
  mermaid: boolean;
  /** Chirpy's `chart:` key — loads Chart.js for this post. */
  chart: boolean;
  /**
   * Cover image, rendered as the `image:` front matter block.
   *
   * `lqip` is the blog build's own work — `update-lqip.js` writes it into every
   * published post — so it is read back and written out again untouched. An
   * editor that dropped it would blank the placeholder on every post it saved,
   * until the next build put it back.
   */
  cover: { path: string; alt: string; lqip?: string } | null;
  /**
   * Front matter keys this app has no field for, kept as the raw lines they
   * arrived on. `redirect_from` is the one the blog uses today, and losing it
   * on an edit would break every old URL pointing at that post.
   */
  extra?: string[];
}

/** One file in a publish request. Content is always base64 of the raw bytes. */
export interface PublishFile {
  path: string;
  contentBase64: string;
}

export interface PublishRequest {
  message: string;
  files: PublishFile[];
  /** Branch to commit to. Created from the repo default branch if missing. */
  branch?: string;
  /** When set, open a pull request from `branch` into the base branch. */
  pullRequest?: { title: string; body?: string } | null;
}

export interface PublishResult {
  repo: string;
  branch: string;
  commitSha: string;
  commitUrl: string;
  paths: string[];
  pullRequestUrl?: string;
}
