import { displaySrc } from "../lib/site.ts";

/** The blog's own vocabulary: callouts, galleries and embeds, as the posts write them. */

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

/** The class each callout is written with on the blog, short as the blog names it: `{: .key }` is Important. */
export const NOTE_CLASSES: Record<NoteType, string> = {
  tip: "tip",
  info: "info",
  important: "key",
  warning: "warn",
  danger: "risk",
  author: "author",
};

export function noteOfClass(name: string): NoteType | null {
  return NOTE_TYPES.find((type) => NOTE_CLASSES[type] === name) ?? null;
}

const PLATFORMS = ["youtube", "x", "audio", "video"] as const;

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

const MEDIA_FILE = /^(?:https?:\/\/|\/(?!\/))\S+\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|webm|mov|ogv)(?:[?#]\S*)?$/i;

const AUDIO = new Set(["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac"]);

export function embedFromUrl(value: string): { platform: string; id: string } | null {
  const url = value.trim();
  const media = MEDIA_FILE.exec(url);
  if (media) {
    return { platform: AUDIO.has(media[1].toLowerCase()) ? "audio" : "video", id: url };
  }
  const youtube =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(url);
  if (youtube) {
    return { platform: "youtube", id: youtube[1] };
  }
  const x = /(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/.exec(url);
  if (x) {
    return { platform: "x", id: x[1] };
  }
  return /^[\w-]{11}$/.test(url) ? { platform: "youtube", id: url } : null;
}

export function embedUrl(platform: string, id: string): string | null {
  switch (platform) {
    case "x":
      return `https://x.com/i/status/${id}`;
    default:
      if (/^https?:\/\//i.test(id)) {
        return id;
      }
      return id.startsWith("/") && !id.startsWith("//") ? displaySrc(id) : null;
  }
}
