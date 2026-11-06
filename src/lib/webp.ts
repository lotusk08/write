import type { WebpAnswer, WebpJob } from "./webp.worker.ts";

const QUALITY = 88;
const MAX_WIDTH = 3840;
const MAX_PIXELS = 16_777_216;
const MAX_BYTES = 4 * 1024 * 1024;
const TRIES = 8;
const TO_WEBP = new Set(["image/jpeg", "image/png"]);
const IDLE_MS = 20_000;

export const becomesWebp = (type: string): boolean => TO_WEBP.has(type);

let encoder: Worker | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
let jobs = 0;
const waiting = new Map<number, { resolve: (webp: ArrayBuffer) => void; reject: (cause: Error) => void }>();

function worker(): Worker {
  if (!encoder) {
    encoder = new Worker(new URL("./webp.worker.ts", import.meta.url), { type: "module" });
    encoder.onmessage = ({ data }: MessageEvent<WebpAnswer>) => {
      const job = waiting.get(data.id);
      waiting.delete(data.id);
      if ("webp" in data) {
        job?.resolve(data.webp);
      } else {
        job?.reject(new Error(data.error));
      }
      if (!waiting.size) {
        idle = setTimeout(stop, IDLE_MS);
      }
    };
    encoder.onerror = (event) => {
      const failure = new Error(event.message || "The WebP encoder could not start.");
      waiting.forEach((job) => job.reject(failure));
      waiting.clear();
      stop();
    };
  }
  return encoder;
}

function stop(): void {
  encoder?.terminate();
  encoder = null;
}

function encode(pixels: ImageData, lossless: boolean): Promise<ArrayBuffer> {
  const id = ++jobs;
  const job: WebpJob = { id, width: pixels.width, height: pixels.height, pixels: pixels.data.buffer as ArrayBuffer, quality: QUALITY, lossless };
  clearTimeout(idle);
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker().postMessage(job, [job.pixels]);
  });
}

function pixelsAt(image: ImageBitmap, width: number): ImageData {
  const height = Math.max(1, Math.round((image.height / image.width) * width));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("This browser cannot draw the photo.");
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

export async function toWebp(blob: Blob): Promise<Blob> {
  const image = await createImageBitmap(blob, { imageOrientation: "from-image" }).catch((cause: unknown) => {
    if (cause instanceof TypeError) {
      return createImageBitmap(blob);
    }
    throw cause;
  });
  try {
    if (!image.width || !image.height) {
      throw new Error("The photo has no size.");
    }
    let width = Math.min(image.width, MAX_WIDTH, Math.floor(Math.sqrt((MAX_PIXELS * image.width) / image.height)));
    let lossless = blob.type === "image/png";
    let smallest: ArrayBuffer | null = null;
    for (let tries = 0; tries < TRIES; tries++) {
      const webp = await encode(pixelsAt(image, width), lossless);
      if (!smallest || webp.byteLength < smallest.byteLength) {
        smallest = webp;
      }
      if (webp.byteLength <= MAX_BYTES) {
        break;
      }
      if (lossless) {
        lossless = false;
      } else {
        width = Math.max(1, Math.round(width * 0.85));
      }
    }
    return new Blob([smallest!], { type: "image/webp" });
  } finally {
    image.close();
  }
}
