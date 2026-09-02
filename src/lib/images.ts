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

const BLOG_MAX_WIDTH = 1760;
const JPEG_QUALITY = 0.85;
const SHRINKABLE = new Set(["image/jpeg", "image/png"]);

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
    if (!naturalWidth || !naturalHeight || naturalWidth <= BLOG_MAX_WIDTH) {
      return blob;
    }
    const canvas = document.createElement("canvas");
    canvas.width = BLOG_MAX_WIDTH;
    canvas.height = Math.max(1, Math.round((naturalHeight / naturalWidth) * BLOG_MAX_WIDTH));
    const context = canvas.getContext("2d");
    if (!context) {
      return blob;
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const shrunk = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, blob.type, JPEG_QUALITY),
    );
    return shrunk && shrunk.type === blob.type && shrunk.size < blob.size ? shrunk : blob;
  } catch {
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
