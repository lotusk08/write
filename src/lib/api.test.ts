import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDropboxVideo, fetchSitePhotos, PasswordRejected, publish, uploadPhoto } from "./api.ts";

function answers(...statuses: number[]) {
  const calls = vi.fn(async () => {
    const status = statuses.shift() ?? 500;
    return Response.json(status === 200 ? { sha: "a".repeat(40) } : { error: `failed ${status}` }, { status });
  });
  vi.stubGlobal("fetch", calls);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

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
    await publish({ message: "m", files: [] }, "pw");
    await fetchSitePhotos(own);
    expect(calls).toHaveBeenCalledTimes(3);
  });
});

describe("uploadPhoto", () => {
  it("tries once more after a server error", async () => {
    const calls = answers(502, 200);
    expect(await uploadPhoto("aGk=", "pw")).toBe("a".repeat(40));
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("does not resend a photo the worker refused, or a wrong password", async () => {
    let calls = answers(400, 200);
    await expect(uploadPhoto("aGk=", "pw")).rejects.toThrow("failed 400");
    expect(calls).toHaveBeenCalledTimes(1);
    calls = answers(401, 200);
    await expect(uploadPhoto("aGk=", "pw")).rejects.toBeInstanceOf(PasswordRejected);
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
    const file = await fetchDropboxVideo("https://www.dropbox.com/scl/fi/x/clip.mp4?dl=0", "pw", new AbortController().signal, () => {});
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect([file.name, file.type, bytes.length]).toEqual(["clip.mp4", "video/mp4", sizes.reduce((sum, size) => sum + size, 0)]);
    expect([bytes[0], bytes[sizes[0]], bytes[sizes[0] + sizes[1]], bytes.at(-1)]).toEqual([1, 2, 3, 4]);
  });
});
