// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { type PreparedVideo, uploadVideo } from "./video.ts";

const VIDEO: PreparedVideo = { blob: new Blob(["video bytes"], { type: "video/mp4" }), source: new Blob(["source bytes"]), type: "video/mp4", width: 1, height: 1, poster: new Blob(["p"], { type: "image/webp" }), note: "" };

function stubNetwork(calls: string[], onPoster = () => {}): void {
  vi.stubGlobal("fetch", async (path: string) => {
    calls.push(path);
    const body = path.includes("start") ? { key: "video/a-0123456789ab.mp4", url: "https://m/video/a-0123456789ab.mp4", upload: "u1" } : { url: "https://m/video/a-0123456789ab.mp4" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  class FakeXhr {
    upload = { onprogress: null };
    status = 0;
    responseText = "";
    onload: null | (() => void) = null;
    onerror = null;
    onabort: null | (() => void) = null;
    path = "";
    open(_method: string, path: string) {
      this.path = path;
    }
    setRequestHeader() {}
    abort() {
      this.onabort?.();
    }
    send() {
      calls.push(this.path);
      if (this.path.includes("poster")) {onPoster();}
      setTimeout(() => {
        this.status = 200;
        this.responseText = JSON.stringify(this.path.includes("part") ? { partNumber: 1, etag: "e1" } : { url: "https://m/video/a-0123456789ab.webp" });
        this.onload?.();
      }, 5);
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
}

afterEach(() => vi.unstubAllGlobals());

describe("stopping a video's upload", () => {
  it("before it starts sends nothing", async () => {
    const calls: string[] = [];
    stubNetwork(calls);
    const controller = new AbortController();
    controller.abort();
    await expect(uploadVideo(VIDEO, "a", "pw", controller.signal, () => undefined)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("while its still is sent ends it, so it does not go in the post", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    stubNetwork(calls, () => controller.abort());
    await expect(uploadVideo(VIDEO, "a", "pw", controller.signal, () => undefined)).rejects.toThrow();
    expect(calls.some((path) => path.includes("poster"))).toBe(true);
  });

  it("names a file sent as it came apart from the MP4 made of it, so a better copy is not taken for the first", async () => {
    const bodies: { fingerprint: string }[] = [];
    vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
      if (path.includes("start")) {
        bodies.push(JSON.parse(String(init?.body)));
      }
      return new Response(JSON.stringify({ key: "video/a-0123456789ab.mp4", url: "https://m/video/a-0123456789ab.mp4" }), { status: 200 });
    });
    const source = new Blob(["the file given"]);
    const sentAsIs = await uploadVideo({ ...VIDEO, blob: source, source, poster: null }, "a", "pw", new AbortController().signal, () => undefined);
    await uploadVideo({ ...VIDEO, source, poster: null }, "a", "pw", new AbortController().signal, () => undefined);
    expect(bodies[0].fingerprint).not.toBe(bodies[1].fingerprint);
    expect(sentAsIs.sent).toBe(false);
  });

  it("goes through when nothing stops it", async () => {
    const calls: string[] = [];
    stubNetwork(calls);
    await expect(uploadVideo(VIDEO, "a", "pw", new AbortController().signal, () => undefined)).resolves.toEqual({
      url: "https://m/video/a-0123456789ab.mp4",
      poster: "https://m/video/a-0123456789ab.webp",
      sent: true,
    });
  });
});
