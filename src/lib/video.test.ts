// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordRejected } from "./api.ts";
import { rememberSession } from "./password.ts";
import { makePoster, type PreparedVideo, uploadVideo } from "./video.ts";

const VIDEO: PreparedVideo = { blob: new Blob(["video bytes"], { type: "video/mp4" }), source: new Blob(["source bytes"]), type: "video/mp4", width: 1, height: 1, poster: async () => new Blob(["p"], { type: "image/webp" }), note: "" };

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stopping a video's upload", () => {
  it("before it starts sends nothing", async () => {
    const calls: string[] = [];
    stubNetwork(calls);
    const controller = new AbortController();
    controller.abort();
    await expect(uploadVideo(VIDEO, "a", controller.signal, () => undefined)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("while its still is sent ends it, so it does not go in the post", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    stubNetwork(calls, () => controller.abort());
    await expect(uploadVideo(VIDEO, "a", controller.signal, () => undefined)).rejects.toThrow();
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
    const sentAsIs = await uploadVideo({ ...VIDEO, blob: source, source, poster: async () => null }, "a", new AbortController().signal, () => undefined);
    await uploadVideo({ ...VIDEO, source, poster: async () => null }, "a", new AbortController().signal, () => undefined);
    expect(bodies[0].fingerprint).not.toBe(bodies[1].fingerprint);
    expect(sentAsIs.sent).toBe(false);
  });

  it("sends the size it measured with the upload, so the library can hand it on", async () => {
    const bodies: { width: number; height: number }[] = [];
    vi.stubGlobal("fetch", async (_path: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ key: "video/a-0123456789ab.mp4", url: "https://m/video/a-0123456789ab.mp4" }), { status: 200 });
    });
    await uploadVideo({ ...VIDEO, width: 1080, height: 1920, poster: async () => null }, "a", new AbortController().signal, () => undefined);
    expect(bodies[0]).toMatchObject({ width: 1080, height: 1920 });
  });

  it("takes no still of a video already stored with one, and hands that one back", async () => {
    const calls: string[] = [];
    stubNetwork(calls);
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ key: "video/a-0123456789ab.mp4", url: "https://m/video/a-0123456789ab.mp4", poster: "https://m/video/a-0123456789ab.jpg" }), { status: 200 }),
    );
    const shoot = vi.fn(async () => new Blob(["p"], { type: "image/webp" }));
    const uploaded = await uploadVideo({ ...VIDEO, poster: shoot }, "a", new AbortController().signal, () => undefined);
    expect(uploaded).toEqual({ url: "https://m/video/a-0123456789ab.mp4", poster: "https://m/video/a-0123456789ab.jpg", posterProblem: "", sent: false });
    expect(shoot).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("goes through when nothing stops it", async () => {
    const calls: string[] = [];
    stubNetwork(calls);
    await expect(uploadVideo(VIDEO, "a", new AbortController().signal, () => undefined)).resolves.toEqual({
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
    await expect(uploadVideo(VIDEO, "a", new AbortController().signal, () => undefined)).resolves.toEqual({
      url: "https://m/video/a-0123456789ab.mp4",
      poster: null,
      posterProblem: "Its still did not upload: Could not upload the video's still.",
      sent: true,
    });
  });

  it("leaves a video without a still unflagged, as the blog takes one when it builds", async () => {
    const calls: string[] = [];
    stubNetwork(calls);
    const uploaded = await uploadVideo({ ...VIDEO, poster: async () => null }, "a", new AbortController().signal, () => undefined);
    expect([uploaded.poster, uploaded.posterProblem]).toEqual([null, ""]);
    expect(calls.some((path) => path.includes("poster"))).toBe(false);
  });

  it("reads the video back through the app in ranges, and says when this browser cannot decode it, sending no poster", async () => {
    const calls: string[] = [];
    stubNetwork(calls);
    vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
      const sent = new Headers(init?.headers);
      calls.push(`${path} ${sent.get("x-write-session")} ${sent.has("x-write-password")} ${sent.get("range")}`);
      return new Response("not a video", { status: 206, headers: { "content-type": "video/mp4", "content-length": "11", "content-range": "bytes 0-10/11" } });
    });
    rememberSession("token");
    await expect(makePoster("video/a-0123456789ab.mp4")).rejects.toThrow("This browser cannot decode this video. Try another browser");
    rememberSession("");
    expect(calls[0]).toBe("/api/media/video?key=video%2Fa-0123456789ab.mp4 token false bytes=0-");
    expect(calls.some((call) => call.includes("poster"))).toBe(false);
  });

  it("says the sign-in was refused when the app will not read the video back", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Wrong password." }), { status: 401 }));
    await expect(makePoster("video/a-0123456789ab.mp4")).rejects.toBeInstanceOf(PasswordRejected);
  });

  it("says the media bucket could not be reached when the connection fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(makePoster("video/a-0123456789ab.mp4")).rejects.toThrow("Could not read the video from the media bucket.");
  });
});
