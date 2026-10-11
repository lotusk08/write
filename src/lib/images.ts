import { bytesToBase64 } from "../../shared/base64.ts";

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
  const suffix = name?.split(".").pop()?.toLowerCase();
  return suffix && /^[a-z0-9]{2,5}$/.test(suffix) ? suffix : "bin";
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

const MAX_WIDTH = 3840;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PIXELS = 16_777_216;
const SHRINKABLE = new Set(["image/jpeg", "image/png"]);

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const shrinks = (blob: Blob, width = 0): boolean =>
  SHRINKABLE.has(blob.type) && (blob.size > MAX_BYTES || width > MAX_WIDTH);

export const tooBig = (blob: Blob): boolean => !SHRINKABLE.has(blob.type) && blob.size > MAX_UPLOAD_BYTES;

export async function shrinkImage(blob: Blob): Promise<Blob> {
  if (!SHRINKABLE.has(blob.type)) {
    return blob;
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const { naturalWidth, naturalHeight } = image;
    if (!naturalWidth || !naturalHeight || (naturalWidth <= MAX_WIDTH && blob.size <= MAX_BYTES)) {
      return blob;
    }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return blob;
    }
    let width = Math.min(naturalWidth, MAX_WIDTH, Math.floor(Math.sqrt((MAX_PIXELS * naturalWidth) / naturalHeight)));
    let quality = 95;
    let best: Blob | null = null;
    let drawnWidth = 0;
    for (let tries = 0; tries < 20; tries++) {
      if (drawnWidth !== width) {
        drawnWidth = width;
        canvas.width = width;
        canvas.height = Math.max(1, Math.round((naturalHeight / naturalWidth) * width));
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      }
      const drawn = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, blob.type, quality / 100));
      if (!drawn || drawn.type !== blob.type) {
        break;
      }
      if (!best || drawn.size < best.size) {
        best = drawn;
      }
      if (drawn.size <= MAX_BYTES) {
        break;
      }
      if (blob.type === "image/jpeg" && quality > 70) {
        quality -= 5;
      } else {
        width = Math.max(1, Math.round(width * 0.85));
      }
    }
    return best && !(naturalWidth <= MAX_WIDTH && blob.size <= best.size) ? best : blob;
  } catch {
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
