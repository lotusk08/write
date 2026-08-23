import encode from "@jsquash/webp/encode";

/**
 * libwebp, off the main thread. A phone photo is twelve megapixels, which is a
 * second or two of encoding — long enough that doing it inline would freeze
 * the app while a post is being prepared for publishing.
 *
 * Pixels come in already decoded: `createImageBitmap` and a canvas are the
 * fast, native way to do that, and not every browser that needs this codec has
 * either of them in a worker.
 */
export interface EncodeRequest {
  id: number;
  /** RGBA, transferred rather than copied. */
  pixels: ArrayBuffer;
  width: number;
  height: number;
  quality: number;
}

export type EncodeResponse =
  | { id: number; ok: true; webp: ArrayBuffer }
  | { id: number; ok: false };

self.addEventListener("message", (event: MessageEvent<EncodeRequest>) => {
  const { id, pixels, width, height, quality } = event.data;
  void (async () => {
    try {
      const image = new ImageData(new Uint8ClampedArray(pixels), width, height);
      const webp = await encode(image, { quality });
      self.postMessage({ id, ok: true, webp } satisfies EncodeResponse, { transfer: [webp] });
    } catch {
      self.postMessage({ id, ok: false } satisfies EncodeResponse);
    }
  })();
});
