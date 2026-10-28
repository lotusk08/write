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

/** The size of one value of each TIFF field type, to find the values an entry keeps outside itself. */
const TIFF_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

/** Blanks the GPS directory of an Exif block in place, its every entry and value, keeping all else, the orientation included. */
function blankGps(bytes: Uint8Array, tiff: number, end: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (tiff + 8 > end) {
    return;
  }
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  const first = tiff + u32(tiff + 4);
  if (first + 2 > end) {
    return;
  }
  for (let entry = first + 2; entry < first + 2 + u16(first) * 12 && entry + 12 <= end; entry += 12) {
    if (u16(entry) !== 0x8825) {
      continue;
    }
    const gps = tiff + u32(entry + 8);
    if (gps + 2 > end) {
      return;
    }
    for (let field = gps + 2; field < gps + 2 + u16(gps) * 12 && field + 12 <= end; field += 12) {
      const size = (TIFF_SIZES[u16(field + 2)] ?? 1) * u32(field + 4);
      if (size > 4) {
        const at = tiff + u32(field + 8);
        bytes.fill(0, Math.min(at, end), Math.min(at + size, end));
      }
      bytes.fill(0, field, field + 12);
    }
    view.setUint16(gps, 0, little);
  }
}

const ascii = (bytes: Uint8Array, at: number, text: string) => [...text].every((char, index) => bytes[at + index] === char.charCodeAt(0));

/** A JPEG with no place in it: the Exif block's GPS directory blanked, and the XMP blocks, which can repeat it, left out. */
function jpegWithoutLocation(bytes: Uint8Array): Uint8Array[] {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === 0xda || marker === 0xd9) {
      break;
    }
    const end = at + 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
    if (end > bytes.length) {
      break;
    }
    if (marker === 0xe1 && (ascii(bytes, at + 4, "http://ns.adobe.com/xap/1.0/\0") || ascii(bytes, at + 4, "http://ns.adobe.com/xmp/extension/\0"))) {
      at = end;
      continue;
    }
    if (marker === 0xe1 && ascii(bytes, at + 4, "Exif\0\0")) {
      try {
        blankGps(bytes, at + 10, end);
      } catch {
        // An Exif block too broken to read for its place goes whole, orientation and all.
        at = end;
        continue;
      }
    }
    parts.push(bytes.subarray(at, end));
    at = end;
  }
  parts.push(bytes.subarray(at));
  return parts;
}

/** A PNG without its Exif and text chunks, where a camera or an app writes where a photo was taken. */
function pngWithoutLocation(bytes: Uint8Array): Uint8Array[] {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  while (at + 12 <= bytes.length) {
    const end = at + 12 + view.getUint32(at);
    if (end > bytes.length) {
      break;
    }
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (!/^(?:eXIf|tEXt|iTXt|zTXt)$/.test(type)) {
      parts.push(bytes.subarray(at, end));
    }
    at = end;
  }
  parts.push(bytes.subarray(at));
  return parts;
}

/** A WebP without its EXIF and XMP chunks, its header's size and flags made to match. */
function webpWithoutLocation(bytes: Uint8Array): Uint8Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const end = Math.min(bytes.length, at + 8 + view.getUint32(at + 4, true) + (view.getUint32(at + 4, true) % 2));
    const type = String.fromCharCode(...bytes.subarray(at, at + 4));
    if (type !== "EXIF" && type !== "XMP ") {
      chunks.push(type === "VP8X" ? bytes.slice(at, end) : bytes.subarray(at, end));
    }
    at = end;
  }
  const extended = chunks.find((chunk) => ascii(chunk, 0, "VP8X"));
  if (extended) {
    extended[8] &= ~0x0c;
  }
  const header = bytes.slice(0, 12);
  new DataView(header.buffer).setUint32(4, 4 + chunks.reduce((size, chunk) => size + chunk.length, 0), true);
  return [header, ...chunks];
}

/**
 * A photo as it is published: with nothing in it of where it was taken. Its pixels are not touched; a JPEG keeps its
 * orientation, which sits beside the place in the Exif block.
 */
export async function withoutLocation(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  try {
    if (blob.type === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) {
      return new Blob(jpegWithoutLocation(bytes) as BlobPart[], { type: blob.type });
    }
    if (blob.type === "image/png" && ascii(bytes, 1, "PNG")) {
      return new Blob(pngWithoutLocation(bytes) as BlobPart[], { type: blob.type });
    }
    if (blob.type === "image/webp" && ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) {
      return new Blob(webpWithoutLocation(bytes) as BlobPart[], { type: blob.type });
    }
  } catch {
    return blob;
  }
  return blob;
}
