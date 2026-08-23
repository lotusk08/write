export interface Settings {
  theme: "light" | "dark" | "system";
  /** Front matter `author:` value. */
  author: string;
  /** Minutes east of UTC used when stamping post dates (+0700 → 420). */
  timezoneOffset: number;
  repo: string;
  branch: string;
  /** Public site URL, used to preview images already published. */
  siteUrl: string;
  postsDir: string;
  draftsDir: string;
  imagesDir: string;
  /** Only used when the deployment has no server-side token. */
  githubToken: string;
  publishTarget: "posts" | "drafts";
  openPullRequest: boolean;
  convertImagesToWebp: boolean;
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
  githubToken: "",
  publishTarget: "posts",
  openPullRequest: false,
  convertImagesToWebp: true,
  menuTab: "post",
  focusMode: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Settings> & { writePassword?: string }) : {};
    const stored = { ...defaultSettings, ...parsed };
    // "drafts" was a tab before drafts moved onto the rail.
    const menuTab: MenuTab = stored.menuTab === "settings" ? "settings" : "post";
    const settings: Settings = { ...stored, menuTab };
    delete (settings as Partial<typeof parsed>).writePassword;
    // The publish password used to be kept here. Take the chance to wipe it.
    if ("writePassword" in parsed) {
      saveSettings(settings);
    }
    return settings;
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Private browsing modes can refuse writes; settings just won't persist.
  }
}
