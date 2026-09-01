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
