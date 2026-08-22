import { bytesToBase64 } from "../../shared/base64.ts";

/** Image handling shared by the editor (storage) and publishing (upload). */

const WEBP_QUALITY = 0.85;

export interface EncodedImage {
  blob: Blob;
  extension: string;
}

function extensionFor(type: string): string {
  const map: Record<string, string> = {
    "image/webp": "webp",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/svg+xml": "svg",
  };
  return map[type] ?? "png";
}

/**
 * Re-encodes an image as WebP to match the blog's asset convention. Animated
 * GIFs and SVGs are passed through untouched, as is anything the browser
 * cannot encode or that would grow in size.
 */
export async function toWebp(blob: Blob): Promise<EncodedImage> {
  const original: EncodedImage = { blob, extension: extensionFor(blob.type) };
  if (blob.type === "image/webp") {
    return { blob, extension: "webp" };
  }
  if (blob.type === "image/gif" || blob.type === "image/svg+xml") {
    return original;
  }

  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) {
      return original;
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const encoded = await canvas.convertToBlob({ type: "image/webp", quality: WEBP_QUALITY });
    if (encoded.type !== "image/webp" || encoded.size >= blob.size) {
      return original;
    }
    return { blob: encoded, extension: "webp" };
  } catch {
    return original;
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}
