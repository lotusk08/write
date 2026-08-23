import { bytesToBase64 } from "../../shared/base64.ts";

/** Image handling shared by the editor (storage) and publishing (upload). */

/**
 * The extension a file should carry, from its type or failing that its name.
 *
 * Images are published in the format they arrived in: the blog's build
 * converts them (`convert-images.js`), which is the one place that has a real
 * encoder — WebKit's canvas has no WebP behind it, so doing it here never
 * worked from an iPhone.
 */
export function extensionFor(type: string, name?: string): string {
  const map: Record<string, string> = {
    "image/webp": "webp",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/svg+xml": "svg",
  };
  const known = map[type];
  if (known) {
    return known;
  }
  // An unknown type is better named from the file than guessed at: a photo
  // straight off a phone can arrive as something this list has never seen,
  // and naming it `.png` would leave the blog serving one that is not.
  const suffix = name?.split(".").pop()?.toLowerCase();
  return suffix && /^[a-z0-9]{2,5}$/.test(suffix) ? suffix : "bin";
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}
