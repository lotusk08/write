import type { AppConfig } from "../../shared/types.ts";

export interface Settings {
  theme: "light" | "dark" | "system";
  author: string;
  timezoneOffset: number;
  repo: string;
  branch: string;
  siteUrl: string;
  postsDir: string;
  draftsDir: string;
  imagesDir: string;
  publishTarget: "posts" | "drafts";
  openPullRequest: boolean;
  menuTab: MenuTab;
  focusMode: boolean;
}

export type MenuTab = "post" | "export" | "share";

const KEY = "write:settings";

export const defaultSettings: Settings = {
  theme: "system",
  author: "steve",
  timezoneOffset: 420,
  repo: "lotusk08/stevehoang.com",
  branch: "blog",
  siteUrl: "https://stevehoang.com",
  postsDir: "_posts",
  draftsDir: "_drafts",
  imagesDir: "assets/img/post",
  publishTarget: "posts",
  openPullRequest: false,
  menuTab: "post",
  focusMode: false,
};

export function resolvedTheme(theme: Settings["theme"]): "light" | "dark" {
  if (theme === "light" || theme === "dark") {
    return theme;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw
      ? (JSON.parse(raw) as Partial<Settings> & {
          githubToken?: string;
          publishToken?: unknown;
          publishPassword?: string;
        })
      : {};
    const stored = { ...defaultSettings, ...parsed };
    const menuTab: MenuTab =
      stored.menuTab === "export" || stored.menuTab === "share" ? stored.menuTab : "post";
    const settings: Settings = { ...stored, menuTab };
    const stale = ["githubToken", "publishToken", "publishPassword"] as const;
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
