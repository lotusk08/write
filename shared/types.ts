export interface AppConfig {
  repo: string;
  branch: string;
  siteUrl: string;
  postsDir: string;
  draftsDir: string;
  imagesDir: string;
  ready: boolean;
  problem?: string;
}

export interface PostMeta {
  title: string;
  description: string;
  date: string;
  lang: string;
  tags: string[];
  pin: boolean;
  toc: boolean;
  cover: { path: string; alt: string; lqip?: string } | null;
  extra?: string[];
}

export interface Topic {
  title: string;
  slug: string;
  count: number;
}

export interface Topics {
  tags: Topic[];
}

export type PublishFile = { path: string } & ({ contentBase64: string } | { sha: string });

export interface PublishRequest {
  message: string;
  files: PublishFile[];
  expect?: { path: string; sha: string };
  remove?: string[];
  redirects?: [string, string][];
}

export interface SitePhoto {
  name: string;
  sha: string;
  shared: boolean;
}

export interface PublishResult {
  repo: string;
  branch: string;
  commitSha: string;
  commitUrl: string;
  paths: string[];
  shas: Record<string, string>;
}
