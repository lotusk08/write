import { displaySrc } from "../lib/site.ts";

/** The blog's own vocabulary: callouts, rows, galleries and embeds, as the posts write them. */

export const CENTER_ROW = "{: .d-flex .c-center }";

const ROW_CLASSES = ["normal", "gap"];

const IAL_BODY = /^\{:\s*|\s*\}$/g;
const rowClass = (name: string) => new RegExp(`\\.${name}(?![\\w-])`);

export function withRowClasses(ial: unknown): string {
  const body = String(ial ?? "").replace(IAL_BODY, "").trim();
  const missing = ROW_CLASSES.filter((name) => !rowClass(name).test(body));
  return `{: ${[body, ...missing.map((name) => `.${name}`)].filter(Boolean).join(" ")} }`;
}

export function withoutRowClasses(ial: unknown): string | null {
  const body = String(ial ?? "")
    .replace(IAL_BODY, "")
    .replace(new RegExp(`\\.(?:${ROW_CLASSES.join("|")})(?![\\w-])`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
  return body ? `{: ${body} }` : null;
}

export const NOTE_TYPES = ["tip", "info", "important", "warning", "danger", "author"] as const;

export type NoteType = (typeof NOTE_TYPES)[number];

export const NOTE_LABELS: Record<NoteType, string> = {
  tip: "Tip",
  info: "Info",
  important: "Important",
  warning: "Warning",
  danger: "Danger",
  author: "Author",
};

export function isNoteType(value: unknown): value is NoteType {
  return (NOTE_TYPES as readonly unknown[]).includes(value);
}

export const GALLERY_KINDS = ["deck", "fan", "peek", "fold"] as const;

export type GalleryKind = (typeof GALLERY_KINDS)[number];

export const GALLERY_LABELS: Record<GalleryKind, string> = {
  deck: "Deck",
  fan: "Fan",
  peek: "Peek",
  fold: "Fold",
};

export function isGalleryKind(value: unknown): value is GalleryKind {
  return (GALLERY_KINDS as readonly unknown[]).includes(value);
}

const PLATFORMS = ["youtube", "x", "bilibili", "spotify", "twitch", "audio", "video"] as const;

const FILE_PLATFORMS = new Set(["audio", "video"]);

function componentName(platform: string): string {
  return `Embed${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
}

export const EMBED_TAG = /^<Embed([A-Z][A-Za-z]*)\s+(?:id|src)=(["'])([^"']+)\2\s*\/>$/;

export const EMBED_LIQUID =
  /^\{%\s*include\s+embed\/([a-z]+)\.html\s+(?:id|src)=(["'])([^"']+)\2\s*%\}$/;

export function embedTag(platform: string, id: string): string {
  const attribute = FILE_PLATFORMS.has(platform) ? "src" : "id";
  const value = id.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<${componentName(platform)} ${attribute}="${value}" />`;
}

export function embedPlatform(component: string): string | null {
  const platform = component.toLowerCase();
  return (PLATFORMS as readonly string[]).includes(platform) ? platform : null;
}

export function embedFromUrl(value: string): { platform: string; id: string } | null {
  const url = value.trim();
  const youtube =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/.exec(url);
  if (youtube) {
    return { platform: "youtube", id: youtube[1] };
  }
  const x = /(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/.exec(url);
  if (x) {
    return { platform: "x", id: x[1] };
  }
  const bilibili = /bilibili\.com\/video\/([\w-]+)/.exec(url);
  if (bilibili) {
    return { platform: "bilibili", id: bilibili[1] };
  }
  const spotify = /spotify\.com\/(?:embed\/)?track\/(\w+)/.exec(url);
  if (spotify) {
    return { platform: "spotify", id: spotify[1] };
  }
  const twitch = /twitch\.tv\/videos\/(\d+)/.exec(url);
  if (twitch) {
    return { platform: "twitch", id: twitch[1] };
  }
  return /^[\w-]{6,}$/.test(url) ? { platform: "youtube", id: url } : null;
}

export function embedUrl(platform: string, id: string): string | null {
  switch (platform) {
    case "x":
      return `https://x.com/i/status/${id}`;
    case "bilibili":
      return `https://www.bilibili.com/video/${id}`;
    case "spotify":
      return `https://open.spotify.com/track/${id}`;
    case "twitch":
      return `https://www.twitch.tv/videos/${id}`;
    default:
      if (/^https?:\/\//i.test(id)) {
        return id;
      }
      return id.startsWith("/") && !id.startsWith("//") ? displaySrc(id) : null;
  }
}
