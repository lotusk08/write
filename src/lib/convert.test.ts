// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

let release: () => void = () => {};
const opened = new Promise<void>((resolve) => (release = resolve));
const log: string[] = [];

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
  return { ALL_FORMATS: [], BlobSource: class {}, BufferTarget: class {}, Mp4OutputFormat: class {}, Input, Output, Conversion, canEncodeAudio: async () => true, canEncodeVideo: async () => true, MATROSKA: {}, MP4: {}, QTFF: {}, WEBM: {}, QUALITY_HIGH: 1 };
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
