import { dropboxFile, isDropbox } from "../../shared/media.ts";
import { displaySrc } from "../lib/site.ts";

export const NOTE_TYPES = ["tip", "info", "important", "warning", "danger", "author", "poem"] as const;

export type NoteType = (typeof NOTE_TYPES)[number];

export const NOTE_LABELS: Record<NoteType, string> = {
  tip: "Tip",
  info: "Info",
  important: "Important",
  warning: "Warning",
  danger: "Danger",
  author: "Author",
  poem: "Poem",
};

export function isNoteType(value: unknown): value is NoteType {
  return (NOTE_TYPES as readonly unknown[]).includes(value);
}

export const NOTE_CLASSES: Record<NoteType, string> = {
  tip: "tip",
  info: "info",
  important: "key",
  warning: "warn",
  danger: "risk",
  author: "author",
  poem: "poem",
};

function noteOfClass(name: string): NoteType | null {
  return NOTE_TYPES.find((type) => NOTE_CLASSES[type] === name) ?? null;
}

export function noteOfIal(line: string): NoteType | null {
  const name = /^\{\s*\.([\w-]+)\s*\}$/.exec(line.trim())?.[1];
  return name ? noteOfClass(name) : null;
}

export const ALERT = /^\[!([A-Za-z]+)\][ \t]*$/;

const GITHUB_ALERTS: Record<string, string> = { note: "info", important: "key", warning: "warn", caution: "risk", danger: "risk" };

export function noteOfAlert(line: string): NoteType | null {
  const name = ALERT.exec(line.trim())?.[1].toLowerCase();
  return name ? noteOfClass(Object.hasOwn(GITHUB_ALERTS, name) ? GITHUB_ALERTS[name] : name) : null;
}

const ATTRIBUTE = String.raw`(?:\.[\w-]+|#[\w-]+|[\w-]+=(?:"[^"]*"|'[^']*'|[^\s"'}]+))`;
const ITEMS = String.raw`[ \t]*${ATTRIBUTE}(?:[ \t]+${ATTRIBUTE})*[ \t]*`;

export const ATTRIBUTES = String.raw`\{${ITEMS}\}`;

export const OLD_ATTRIBUTES = String.raw`\{:${ITEMS}\}`;

const OLD = new RegExp(String.raw`(?<!\\)${OLD_ATTRIBUTES}`, "g");

export function pandocAttributes(text: string): string {
  return text.replace(OLD, (list) => `{${list.slice(2, -1).trim()}}`);
}

const PLATFORMS = ["youtube", "x", "audio", "video"] as const;

const FILE_PLATFORMS = new Set(["audio", "video"]);

function componentName(platform: string): string {
  return `Embed${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
}

const EXTRA = String.raw`(?:\s+[A-Za-z][\w-]*(?:=(?:"[^"<>]*"|'[^'<>]*'))?)*`;
const WELL_FORMED = new RegExp(`^${EXTRA}$`);

export const EMBED_TAG = new RegExp(String.raw`^<Embed([A-Z][A-Za-z]*)\s+(?:id|src)=(["'])([^"']+)\2(${EXTRA})\s*\/>$`);

export const EMBED_LIQUID =
  /^\{%\s*include\s+embed\/([a-z]+)\.html\s+(?:id|src)=(["'])([^"']+)\2\s*%\}$/;

export interface Embed {
  platform: string;
  id: string;
  extra?: string;
}

const quoted = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const unquoted = (value: string) =>
  value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export function embedTag(platform: string, id: string, extra = ""): string {
  const attribute = FILE_PLATFORMS.has(platform) ? "src" : "id";
  return `<${componentName(platform)} ${attribute}="${quoted(id)}"${WELL_FORMED.test(extra) ? extra : ""} />`;
}

export function embedExtra(fields: Record<string, string | number | null | undefined>): string {
  return Object.entries(fields)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([name, value]) => ` ${name}="${quoted(String(value))}"`)
    .join("");
}

const ATTRIBUTE_ITEM = /\s+([\w-]+)(?:=(?:"[^"]*"|'[^']*'))?/g;

export function mergeExtra(extra: string | undefined, fields: Record<string, string | number | null | undefined>): string {
  const kept = [...(extra ?? "").matchAll(ATTRIBUTE_ITEM)].filter(([, name]) => !Object.hasOwn(fields, name)).map(([written]) => written);
  return kept.join("") + embedExtra(fields);
}

export function embedField(extra: string | undefined, name: string): string | null {
  const found = new RegExp(String.raw`(?:^|\s)${name}=(?:"([^"]*)"|'([^']*)')`).exec(extra ?? "");
  return found ? unquoted(found[1] ?? found[2]) : null;
}

export function embedPlatform(component: string): string | null {
  const platform = component.toLowerCase();
  return (PLATFORMS as readonly string[]).includes(platform) ? platform : null;
}

export function embedFromTag(text: string): Embed | null {
  const tag = EMBED_TAG.exec(text.trim());
  const platform = tag ? embedPlatform(tag[1]) : null;
  return tag && platform ? { platform, id: unquoted(tag[3]), ...(tag[4] ? { extra: tag[4] } : {}) } : null;
}

const MEDIA_FILE = /^(?:https?:\/\/|\/(?!\/))\S+\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|webm|mov|ogv|m3u8)(?:[?#]\S*)?$/i;

const AUDIO = new Set(["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac"]);

const BARE_LINK = /^(?:www\.|m\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be|dropbox\.com)\/\S+$/i;
const YOUTUBE = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/;
const START = /[?&#](?:t|start)=(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?(?:&|$)/;

export function youtubeOf(url: string): { id: string; start: number; short: boolean } | null {
  const found = YOUTUBE.exec(url);
  if (!found) {
    return null;
  }
  const [, h = "0", m = "0", s = "0"] = START.exec(url) ?? [];
  return { id: found[1], start: Number(h) * 3600 + Number(m) * 60 + Number(s), short: /\/shorts\//.test(url) };
}

function withScheme(value: string): string {
  const text = value.trim();
  return BARE_LINK.test(text) ? `https://${text}` : text;
}

export const isPlayerLink = (value: string) => /^https?:\/\/\S+$/.test(withScheme(value));

export function embedFromUrl(value: string): { platform: string; id: string } | null {
  const url = withScheme(value);
  const media = MEDIA_FILE.exec(url);
  if (media) {
    return { platform: AUDIO.has(media[1].toLowerCase()) ? "audio" : "video", id: url };
  }
  const youtube = youtubeOf(url);
  if (youtube?.short) {
    return { platform: "video", id: `https://www.youtube.com/shorts/${youtube.id}${youtube.start ? `?t=${youtube.start}` : ""}` };
  }
  if (youtube?.start) {
    return { platform: "video", id: `https://youtu.be/${youtube.id}?t=${youtube.start}` };
  }
  if (youtube) {
    return { platform: "youtube", id: youtube.id };
  }
  const x = /(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/.exec(url);
  if (x) {
    return { platform: "x", id: x[1] };
  }
  return /^[\w-]{11}$/.test(url) ? { platform: "youtube", id: url } : null;
}

export function playableUrl(url: string): string {
  return isDropbox(url) ? dropboxFile(url) : url;
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
