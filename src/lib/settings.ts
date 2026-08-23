import type { AppConfig } from "../../shared/types.ts";

/**
 * What this browser remembers. Not the blog's address, its branch or its
 * directories — those belong to the deployment and arrive from `/api/config`
 * at startup — and no GitHub token: the Worker holds the only one there is.
 * The password that unlocks it is kept here, so it is typed once on a device
 * rather than once a post.
 */
export interface Settings {
  theme: "light" | "dark" | "system";
  /** Front matter `author:` value. */
  author: string;
  /** Minutes east of UTC used when stamping post dates (+0700 → 420). */
  timezoneOffset: number;
  /** From the deployment. */
  repo: string;
  branch: string;
  /** Public site URL, used to preview images already published. */
  siteUrl: string;
  postsDir: string;
  draftsDir: string;
  imagesDir: string;
  /** Sent to the Worker with every publish. Typed once, then remembered. */
  publishPassword: string;
  publishTarget: "posts" | "drafts";
  openPullRequest: boolean;
  /** Which tab the pop-up menu opens on. */
  menuTab: MenuTab;
  /** Hides the bottom toolbar. */
  focusMode: boolean;
}

export type MenuTab = "post" | "settings";

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
  publishPassword: "",
  publishTarget: "posts",
  openPullRequest: false,
  menuTab: "post",
  focusMode: false,
};

/**
 * The theme actually on screen. A new browser follows the system until a mode
 * is picked, and picking one overrides it from then on.
 */
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
        })
      : {};
    const stored = { ...defaultSettings, ...parsed };
    // "drafts" was a tab before drafts moved onto the rail.
    const menuTab: MenuTab = stored.menuTab === "settings" ? "settings" : "post";
    const settings: Settings = { ...stored, menuTab };
    // GitHub tokens used to be kept here, one of them locked behind a
    // password. The Worker holds the only one now, so loading is the moment to
    // get them out of this browser for good.
    const stale = ["githubToken", "publishToken"] as const;
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

/**
 * Folds the deployment's own answer over what this browser had. A repository
 * or branch typed into an older build of the app loses to what the Worker is
 * actually committing to, which is the only one that can be right.
 */
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
    // Private browsing modes can refuse writes; settings just won't persist.
  }
}
