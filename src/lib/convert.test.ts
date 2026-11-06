// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

let release: () => void = () => {};
const opened = new Promise<void>((resolve) => (release = resolve));
const log: string[] = [];
let encodes = true;

vi.mock("mediabunny", () => {
  class Input {
    async getPrimaryVideoTrack() {
      await opened;
      return { getCodec: async () => "hevc", getDisplayWidth: async () => 3840, getDisplayHeight: async () => 2160, getAverageBitrate: async () => 50e6 };
    }
    dispose() {}
  }
  class Output {
    target = { buffer: new ArrayBuffer(4) };
  }
  const Conversion = {
    init: async () => ({
      isValid: true,
      utilizedTracks: [{ isVideoTrack: () => true }],
      onProgress: null,
      cancel: async () => void log.push("cancel"),
      execute: async () => void log.push("execute"),
    }),
  };
  return { ALL_FORMATS: [], BlobSource: class {}, BufferTarget: class {}, Mp4OutputFormat: class {}, Input, Output, Conversion, canEncodeAudio: async () => true, canEncodeVideo: async () => encodes, MATROSKA: {}, MP4: {}, QTFF: {}, WEBM: {}, QUALITY_HIGH: 1 };
});

it("stops before converting when Stop is pressed while the file is still being opened", async () => {
  (globalThis as { VideoEncoder?: unknown }).VideoEncoder = class {};
  const { prepareVideo } = await import("./video.ts");
  const controller = new AbortController();
  const done = prepareVideo(new File(["x"], "a.mov", { type: "video/quicktime" }), controller.signal, () => {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  release();
  await expect(done).rejects.toThrow();
  expect(log).not.toContain("execute");
});

it("keeps the size it read from a video this browser can neither encode nor decode", async () => {
  encodes = false;
  const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")!;
  Object.defineProperty(HTMLMediaElement.prototype, "src", {
    ...src,
    set(this: HTMLMediaElement, value: string) {
      src.set!.call(this, value);
      setTimeout(() => this.dispatchEvent(new Event("error")));
    },
  });
  try {
    const { prepareVideo } = await import("./video.ts");
    const video = await prepareVideo(new File(["x"], "a.mp4", { type: "video/mp4" }), new AbortController().signal, () => {});
    expect([video.width, video.height, video.poster]).toEqual([3840, 2160, null]);
  } finally {
    Object.defineProperty(HTMLMediaElement.prototype, "src", src);
  }
});
