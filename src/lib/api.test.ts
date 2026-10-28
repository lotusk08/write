import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSitePhotos, PasswordRejected, publish, uploadPhoto } from "./api.ts";

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
