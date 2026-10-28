import type { AppConfig } from "../../shared/types.ts";

export interface Settings {
  theme: "light" | "dark" | "system";
  repo: string;
  branch: string;
  siteUrl: string;
  postsDir: string;
  draftsDir: string;
  imagesDir: string;
  publishTarget: "posts" | "drafts";
  focusMode: boolean;
}

const KEY = "write:settings";

const defaultSettings: Settings = {
  theme: "system",
  repo: "lotusk08/stevehoang.com",
  branch: "blog",
  siteUrl: "https://stevehoang.com",
  postsDir: "src/posts",
  draftsDir: "src/drafts",
  imagesDir: "public/assets/img/post",
  publishTarget: "posts",
  focusMode: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw
      ? (JSON.parse(raw) as Partial<Settings> & {
          githubToken?: string;
          publishToken?: unknown;
          publishPassword?: string;
          author?: string;
          timezoneOffset?: number;
          openPullRequest?: boolean;
          menuTab?: string;
        })
      : {};
    const settings: Settings = { ...defaultSettings, ...parsed };
    const stale = [
      "githubToken",
      "publishToken",
      "publishPassword",
      "author",
      "timezoneOffset",
      "openPullRequest",
      "menuTab",
    ] as const;
    for (const key of stale) {
      delete (settings as Partial<typeof parsed>)[key];
    }
    if (stale.some((key) => key in parsed)) {
      saveSettings(settings);
    }
    return settings;
  } catch {
    return { ...defaultSettings };
  }
}

export function applyConfig(settings: Settings, config: AppConfig): Settings {
  return {
    ...settings,
    repo: config.repo || settings.repo,
    branch: config.branch || settings.branch,
    siteUrl: config.siteUrl || settings.siteUrl,
    postsDir: config.postsDir || settings.postsDir,
    draftsDir: config.draftsDir || settings.draftsDir,
    imagesDir: config.imagesDir || settings.imagesDir,
  };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
  }
}
