/**
 * Types and helpers with no DOM in them, kept apart from the editor so they can
 * be read — and tested — on their own. They were shared with a Worker once; the
 * app talks to GitHub directly now.
 */

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
  /** Cover image, rendered as the `image:` front matter block. */
  cover: { path: string; alt: string } | null;
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
