// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBucketVideo } from "./api.ts";
import { makePoster, type PreparedVideo, uploadVideo } from "./video.ts";

const VIDEO: PreparedVideo = { blob: new Blob(["video bytes"], { type: "video/mp4" }), source: new Blob(["source bytes"]), type: "video/mp4", width: 1, height: 1, poster: new Blob(["p"], { type: "image/webp" }), note: "" };

function stubNetwork(calls: string[], onPoster = () => {}, posterStatus = 200): void {
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
        this.status = this.path.includes("poster") ? posterStatus : 200;
        this.responseText = JSON.stringify(
          this.path.includes("part") ? { partNumber: 1, etag: "e1" } : this.status === 200 ? { url: "https://m/video/a-0123456789ab.webp" } : { error: "Could not upload the video's still." },
        );
        this.onload?.();
      }, 5);
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
}

function browserCannotDecode(): () => void {
  const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")!;
  Object.defineProperty(HTMLMediaElement.prototype, "src", {
    ...src,
    set(this: HTMLMediaElement, value: string) {
      src.set!.call(this, value);
      setTimeout(() => this.dispatchEvent(new Event("error")));
    },
  });
  return () => Object.defineProperty(HTMLMediaElement.prototype, "src", src);
}

let restore = () => {};

afterEach(() => {
  vi.unstubAllGlobals();
  restore();
  restore = () => {};
});

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

  it("sends the size it measured with the upload, so the library can hand it on", async () => {
    const bodies: { width: number; height: number }[] = [];
    vi.stubGlobal("fetch", async (_path: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ key: "video/a-0123456789ab.mp4", url: "https://m/video/a-0123456789ab.mp4" }), { status: 200 });
    });
    await uploadVideo({ ...VIDEO, width: 1080, height: 1920, poster: null }, "a", "pw", new AbortController().signal, () => undefined);
    expect(bodies[0]).toMatchObject({ width: 1080, height: 1920 });
  });

  it("goes through when nothing stops it", async () => {
    const calls: string[] = [];
    stubNetwork(calls);
    await expect(uploadVideo(VIDEO, "a", "pw", new AbortController().signal, () => undefined)).resolves.toEqual({
      url: "https://m/video/a-0123456789ab.mp4",
      poster: "https://m/video/a-0123456789ab.webp",
      posterProblem: "",
      sent: true,
    });
  });
});

describe("a video without its poster", () => {
  it("still uploads when its still is refused, and says why it has none", async () => {
    stubNetwork([], () => {}, 500);
    await expect(uploadVideo(VIDEO, "a", "pw", new AbortController().signal, () => undefined)).resolves.toEqual({
      url: "https://m/video/a-0123456789ab.mp4",
      poster: null,
      posterProblem: "Its still did not upload: Could not upload the video's still.",
      sent: true,
    });
  });

  it("leaves a video without a still unflagged, as the blog takes one when it builds", async () => {
    const calls: string[] = [];
    stubNetwork(calls);
    const uploaded = await uploadVideo({ ...VIDEO, poster: null }, "a", "pw", new AbortController().signal, () => undefined);
    expect([uploaded.poster, uploaded.posterProblem]).toEqual([null, ""]);
    expect(calls.some((path) => path.includes("poster"))).toBe(false);
  });

  it("reads the whole of a short video back through the app and says when this browser cannot decode it, sending no poster", async () => {
    const calls: string[] = [];
    stubNetwork(calls);
    vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
      const sent = new Headers(init?.headers);
      calls.push(`${path} ${sent.get("x-write-password")} ${sent.get("range")}`);
      return new Response("not a video", { status: 206, headers: { "content-type": "video/mp4", "content-length": "11", "content-range": "bytes 0-10/11" } });
    });
    restore = browserCannotDecode();
    await expect(makePoster("video/a-0123456789ab.mp4", "pw")).rejects.toThrow("This browser cannot decode this video. Try another browser");
    expect(calls).toEqual(["/api/media/video?key=video%2Fa-0123456789ab.mp4 pw bytes=0-33554431"]);
  });

  it("reads only the start of a long video, and says the blog takes a still when that start gives none", async () => {
    stubNetwork([]);
    vi.stubGlobal("fetch", async () => new Response("the first bytes", { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-33554431/4000000000" } }));
    restore = browserCannotDecode();
    await expect(makePoster("video/a-0123456789ab.mp4", "pw")).rejects.toThrow(/first 32 MB .* The blog takes a still from it when it builds/);
  });

  it("stops reading at the limit when the server sends the whole video anyway", async () => {
    vi.stubGlobal("fetch", async () => new Response("0123456789", { status: 200, headers: { "content-type": "video/mp4", "content-length": "10" } }));
    const read = await fetchBucketVideo("video/a-0123456789ab.mp4", "pw", new AbortController().signal, 4);
    expect([await read.file.text(), read.whole]).toEqual(["0123", false]);
  });

  it("says the media bucket could not be reached when the connection fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(makePoster("video/a-0123456789ab.mp4", "pw")).rejects.toThrow("Could not read the video from the media bucket.");
  });
});
