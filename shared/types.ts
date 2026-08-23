/** Types shared between the browser app and the Cloudflare Worker. */

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

/** What the worker tells the app about itself on boot. */
export interface AppConfig {
  /** `server`: the worker holds the GitHub token. `browser`: the app must supply one. */
  publishMode: "server" | "browser";
  /** True when the worker requires a password before publishing. */
  authRequired: boolean;
  repo: string;
  branch: string;
  /** Where the blog is served, so published images can be previewed. */
  siteUrl: string;
  postsDir: string;
  draftsDir: string;
  imagesDir: string;
  /** Set when the worker is configured in a way that blocks publishing. */
  warning?: string;
}
