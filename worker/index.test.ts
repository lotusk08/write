import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const { default: worker } = await import("./index.ts");

const env = { GITHUB_TOKEN: "t", WRITE_PASSWORD: "pw", BLOG_REPO: "o/r", BLOG_BRANCH: "blog" } as never;

function call(path: string, init: RequestInit & { password?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.password) {
    headers.set("x-write-password", init.password);
  }
  return worker.fetch(new Request(`https://write.test${path}`, { ...init, headers }), env);
}

function publish(body: unknown) {
  return call("/api/publish", { method: "POST", password: "pw", body: JSON.stringify(body) });
}

const post = { path: "src/posts/2026-10-11-trip.md", contentBase64: "aGk=" };

afterEach(() => vi.unstubAllGlobals());

describe("worker", () => {
  it("asks for the password on every writing or draft-reading endpoint", async () => {
    for (const [path, method] of [
      ["/api/publish", "POST"],
      ["/api/publish/photo", "POST"],
      ["/api/drafts", "GET"],
      ["/api/source?path=src/drafts/x.md", "GET"],
    ]) {
      expect((await call(path, { method, body: method === "POST" ? "{}" : undefined })).status).toBe(401);
      expect((await call(path, { method, password: "wrong", body: method === "POST" ? "{}" : undefined })).status).toBe(401);
    }
  });

  it("refuses paths and entries outside what a publish may touch", async () => {
    const photo = { path: "public/assets/img/post/a.webp", sha: "a".repeat(40) };
    for (const body of [
      { files: [{ ...post, path: "src/posts/../../.github/workflows/x.yml" }] },
      { files: [{ ...post, path: "src/posts/%2e%2e/x.md" }] },
      { files: [{ ...post, path: ".github/workflows/x.yml" }] },
      { files: [{ path: photo.path, sha: "not-a-sha" }] },
      { files: Array.from({ length: 51 }, (_, index) => ({ ...photo, path: `public/assets/img/post/${index}.webp` })) },
      { files: [post], remove: ["src/posts/2026-10-11-trip.md"] },
      { files: [post], remove: ["src/drafts/notes.txt"] },
      { files: [post], remove: ["public/assets/img/post/../../index.html"] },
      { files: [post], expect: { path: ".github/x.md", sha: "a".repeat(40) } },
      { files: [post], expect: { path: post.path, sha: "nope" } },
      { files: [post], redirects: [["/assets/img/post/a.webp", "/assets/img/post/sub/b.webp"]] },
      { files: [post], redirects: [["/elsewhere/a.webp", "/assets/img/post/b.webp"]] },
      { files: [post], redirects: [["/assets/img/post/a.webp"]] },
      { files: [post], redirects: [["/assets/img/post/", "/assets/img/post/b.webp"]] },
    ]) {
      expect((await publish(body)).status, JSON.stringify(body).slice(0, 120)).toBe(400);
    }
  });

  it("caps a photo at 8 MB and takes only base64", async () => {
    const big = "A".repeat(Math.ceil((8 * 1024 * 1024 * 4) / 3) + 8);
    expect((await call("/api/publish/photo", { method: "POST", password: "pw", body: big })).status).toBe(400);
    expect((await call("/api/publish/photo", { method: "POST", password: "pw", body: "not base64!" })).status).toBe(400);
    expect((await call("/api/publish/photo", { method: "POST", password: "pw", body: "" })).status).toBe(400);
  });

  it("tells which photos another file still uses, without naming the drafts", async () => {
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/graphql") {
        return Response.json({
          data: {
            repository: {
              d0: { entries: [{ name: "2026-10-11-trip.md", object: { text: "![](/assets/img/post/a.webp) ![](/assets/img/post/b%20c.jpg)" } }] },
              d1: { entries: [{ name: "secret.md", object: { text: "![](/assets/img/post/b%20c.webp)" } }] },
              d2: null,
            },
          },
        });
      }
      if (url.pathname.endsWith("/contents/public/assets/img/post")) {
        return Response.json(["a.webp", "b c.webp"].map((name) => ({ name, sha: name, type: "file" })));
      }
      return Response.json({ message: "Not Found" }, { status: 404 });
    });
    const response = await call(`/api/images?own=${encodeURIComponent(post.path)}`);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      files: [
        { name: "a.webp", sha: "a.webp", shared: false },
        { name: "b c.webp", sha: "b c.webp", shared: true },
      ],
      redirected: [],
    });
    expect(body).not.toContain("secret");
  });
});
