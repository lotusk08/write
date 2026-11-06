import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDropboxVideo, fetchSiteFiles, fetchSitePhotos, login, PasswordRejected, publish, uploadPhoto } from "./api.ts";

const kept = vi.hoisted(() => ({ session: "" }));
vi.mock("./password.ts", () => ({ sessionToken: () => kept.session }));

function answers(...statuses: number[]) {
  const calls = vi.fn(async () => {
    const status = statuses.shift() ?? 500;
    return Response.json(status === 200 ? { sha: "a".repeat(40) } : { error: `failed ${status}` }, { status });
  });
  vi.stubGlobal("fetch", calls);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("login", () => {
  it("sends the password once to sign in, then only the session", async () => {
    const sent: Headers[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      sent.push(new Headers(init?.headers));
      return Response.json({ session: "s1", posts: [], drafts: [] });
    });
    expect(await login("pw")).toBe("s1");
    kept.session = "s1";
    await fetchSiteFiles();
    kept.session = "";
    expect(sent.map((headers) => [headers.get("x-write-password"), headers.get("x-write-session")])).toEqual([
      ["pw", null],
      [null, "s1"],
    ]);
  });

  it("says a wrong password was refused", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Wrong password." }, { status: 401 }));
    await expect(login("typo")).rejects.toBeInstanceOf(PasswordRejected);
  });
});

describe("fetchSitePhotos", () => {
  it("reads the site's photos once a minute for the same post, and afresh after a publish", async () => {
    const calls = vi.fn(async (url: string) =>
      Response.json(url.includes("/api/images") ? { files: [{ name: "a.webp", sha: "a".repeat(40), shared: false }], redirected: [] } : {}),
    );
    vi.stubGlobal("fetch", calls);
    const own = [`src/posts/${Math.random()}.md`];
    await fetchSitePhotos(own);
    expect((await fetchSitePhotos(own)).files).toHaveLength(1);
    expect(calls).toHaveBeenCalledTimes(1);
    await publish({ message: "m", files: [] });
    await fetchSitePhotos(own);
    expect(calls).toHaveBeenCalledTimes(3);
  });
});

describe("uploadPhoto", () => {
  const photo = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

  it("sends the blob GitHub takes, and tries twice more, waiting longer each time, after server errors", async () => {
    vi.useFakeTimers();
    try {
      const calls = answers(503, 503, 200);
      const sha = uploadPhoto(photo);
      await vi.advanceTimersByTimeAsync(1999);
      expect(calls).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await sha).toBe("a".repeat(40));
      expect(calls).toHaveBeenCalledTimes(3);
      const sent = (calls.mock.calls[0] as unknown as [string, RequestInit])[1];
      expect(JSON.parse(String(sent.body))).toEqual({ content: "AQID", encoding: "base64" });
      expect(new Headers(sent.headers).get("content-type")).toBe("application/json");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after three tries", async () => {
    vi.useFakeTimers();
    try {
      const calls = answers(503, 503, 503, 200);
      const failed = uploadPhoto(photo).catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expect(await failed).toBeInstanceOf(Error);
      expect(calls).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not resend a photo the worker refused, or a wrong password", async () => {
    let calls = answers(400, 200);
    await expect(uploadPhoto(photo)).rejects.toThrow("failed 400");
    expect(calls).toHaveBeenCalledTimes(1);
    calls = answers(401, 200);
    await expect(uploadPhoto(photo)).rejects.toBeInstanceOf(PasswordRejected);
    expect(calls).toHaveBeenCalledTimes(1);
  });
});

describe("fetchDropboxVideo", () => {
  it("hands back every byte in order, however many parts it was held in", async () => {
    const sizes = [9, 9, 9, 1].map((megabytes) => megabytes * 1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        sizes.forEach((size, index) => controller.enqueue(new Uint8Array(size).fill(index + 1)));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", async () => new Response(body, { headers: { "content-type": "video/mp4" } }));
    const file = await fetchDropboxVideo("https://www.dropbox.com/scl/fi/x/clip.mp4?dl=0", new AbortController().signal, () => {});
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect([file.name, file.type, bytes.length]).toEqual(["clip.mp4", "video/mp4", sizes.reduce((sum, size) => sum + size, 0)]);
    expect([bytes[0], bytes[sizes[0]], bytes[sizes[0] + sizes[1]], bytes.at(-1)]).toEqual([1, 2, 3, 4]);
  });
});
