import { bytesToBase64 } from "../../shared/base64.ts";
import type { EncodeRequest, EncodeResponse } from "./webpWorker.ts";

/** Image handling shared by the editor (storage) and publishing (upload). */

const WEBP = "image/webp";
/** libwebp's own scale; the canvas encoders take the same number over 100. */
const WEBP_QUALITY = 85;

/** Why an image is being published in the format it is. */
export type EncodeOutcome =
  | "encoded"
  /** Already a WebP, or an animation or vector that would not survive one. */
  | "kept"
  /** WebP came out heavier than the original, so the original went instead. */
  | "larger"
  /** Neither encoder could read or write it. */
  | "failed";

export interface EncodedImage {
  blob: Blob;
  extension: string;
  outcome: EncodeOutcome;
}

/** The extension a file should carry, from its type or failing that its name. */
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

/** Left alone: one is animated, the other has no pixels to re-encode. */
function passthrough(type: string): boolean {
  return type === "image/gif" || type === "image/svg+xml";
}

interface Surface {
  /** The browser's own encoder, which may not have WebP among its formats. */
  native: () => Promise<Blob | null>;
  pixels: () => ImageData | null;
}

/** The image drawn on whichever kind of canvas this browser has. */
function surfaceFor(bitmap: ImageBitmap): Surface | null {
  const { width, height } = bitmap;

  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    context.drawImage(bitmap, 0, 0);
    return {
      native: () => canvas.convertToBlob({ type: WEBP, quality: WEBP_QUALITY / 100 }),
      pixels: () => context.getImageData(0, 0, width, height),
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  context.drawImage(bitmap, 0, 0);
  return {
    native: () =>
      new Promise((resolve) => canvas.toBlob(resolve, WEBP, WEBP_QUALITY / 100)),
    pixels: () => context.getImageData(0, 0, width, height),
  };
}

/** Undefined until one has been asked for; null once one has been refused. */
let encoder: Worker | null | undefined;
let nextRequest = 0;

function encoderWorker(): Worker | null {
  if (encoder === undefined) {
    try {
      encoder = new Worker(new URL("./webpWorker.ts", import.meta.url), { type: "module" });
    } catch {
      encoder = null;
    }
  }
  return encoder;
}

/**
 * WebKit has no WebP encoder behind its canvas — `toBlob` and `convertToBlob`
 * quietly hand back a PNG instead — so every image published from an iPhone
 * used to go up in the format it arrived in, which the blog's placeholder pass
 * then skipped. libwebp is fetched only when that happens, and runs in a
 * worker: twelve megapixels is a second or two, and the app has to stay live.
 */
async function encodeWithCodec(pixels: ImageData): Promise<Blob | null> {
  const worker = encoderWorker();
  if (!worker) {
    try {
      const { default: encode } = await import("@jsquash/webp/encode");
      return new Blob([await encode(pixels, { quality: WEBP_QUALITY })], { type: WEBP });
    } catch {
      return null;
    }
  }

  const id = (nextRequest += 1);
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent<EncodeResponse>) => {
      if (event.data.id !== id) {
        return;
      }
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      resolve(event.data.ok ? new Blob([event.data.webp], { type: WEBP }) : null);
    };
    const onError = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      // These pixels went with it — they are transferred, not copied — but the
      // next image can be encoded in here rather than asking it again.
      encoder = null;
      resolve(null);
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    const request: EncodeRequest = {
      id,
      pixels: pixels.data.buffer as ArrayBuffer,
      width: pixels.width,
      height: pixels.height,
      quality: WEBP_QUALITY,
    };
    worker.postMessage(request, [request.pixels]);
  });
}


/**
 * Re-encodes an image as WebP to match the blog's asset convention: it only
 * generates placeholders and dimensions for `.webp`, so anything else is
 * published without them.
 */
export async function toWebp(blob: Blob, name?: string): Promise<EncodedImage> {
  const original: EncodedImage = {
    blob,
    extension: extensionFor(blob.type, name),
    outcome: "kept",
  };
  if (blob.type === WEBP) {
    return { blob, extension: "webp", outcome: "kept" };
  }
  if (passthrough(blob.type)) {
    return original;
  }

  try {
    const bitmap = await createImageBitmap(blob);
    const surface = surfaceFor(bitmap);
    bitmap.close();
    if (!surface) {
      return { ...original, outcome: "failed" };
    }

    let encoded = await surface.native().catch(() => null);
    if (encoded?.type !== WEBP) {
      const pixels = surface.pixels();
      encoded = pixels ? await encodeWithCodec(pixels) : null;
    }
    if (!encoded) {
      return { ...original, outcome: "failed" };
    }
    if (encoded.size >= blob.size) {
      return { ...original, outcome: "larger" };
    }
    return { blob: encoded, extension: "webp", outcome: "encoded" };
  } catch {
    return { ...original, outcome: "failed" };
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}
