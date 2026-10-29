export const PART_BYTES = 16 * 1024 * 1024;

export const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;

export const MAX_POSTER_BYTES = 2 * 1024 * 1024;

export const VIDEO_TYPES: Partial<Record<string, string>> = { "video/mp4": "mp4", "video/webm": "webm" };

export const POSTER_TYPES: Partial<Record<string, string>> = { "image/webp": "webp", "image/jpeg": "jpg" };

export const VIDEO_KEY = /^video\/[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{12}\.(?:mp4|webm)$/;

export function videoKey(name: string, fingerprint: string, extension: string): string {
  const words = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");
  return `video/${words || "video"}-${fingerprint.slice(0, 12)}.${extension}`;
}

const KEY_IN_TEXT = /video\/[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{12}\.(?:mp4|webm)/g;

export function videoKeysIn(text: string): string[] {
  return [...new Set(text.match(KEY_IN_TEXT) ?? [])];
}

const DROPBOX = /^https:\/\/(?:www\.)?dropbox\.com\/(?:scl\/fi|s)\//;

export const isDropbox = (url: string) => DROPBOX.test(url);

export function dropboxFile(url: string): string {
  const direct = new URL(url);
  direct.hostname = "dl.dropboxusercontent.com";
  direct.searchParams.delete("dl");
  direct.searchParams.delete("raw");
  return direct.href;
}

export function posterKey(key: string, extension: string): string {
  return key.replace(/\.[a-z0-9]+$/, `.${extension}`);
}

export interface MediaStart {
  key: string;
  url: string;
  upload?: string;
}

export interface MediaPart {
  partNumber: number;
  etag: string;
}

export interface MediaVideo {
  key: string;
  url: string;
  size: number;
  uploaded: number;
  poster: string | null;
  used: string[];
}
