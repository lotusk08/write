import encode from "@jsquash/webp/encode";

export interface WebpJob {
  id: number;
  width: number;
  height: number;
  pixels: ArrayBuffer;
  quality: number;
  lossless: boolean;
}

export type WebpAnswer = { id: number; webp: ArrayBuffer } | { id: number; error: string };

self.onmessage = async ({ data }: MessageEvent<WebpJob>) => {
  try {
    const image = new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height);
    const webp = await encode(image, { quality: data.quality, lossless: data.lossless ? 1 : 0, exact: 0 });
    self.postMessage({ id: data.id, webp } satisfies WebpAnswer, { transfer: [webp] });
  } catch (cause) {
    self.postMessage({ id: data.id, error: cause instanceof Error ? cause.message : String(cause) } satisfies WebpAnswer);
  }
};
