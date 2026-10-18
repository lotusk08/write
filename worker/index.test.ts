import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const { default: worker, siteFile } = await import("./index.ts");

const failures = new Map<string, number>();
const passkeys = {
  idFromName: () => "owner",
  get: () => ({
    attempt: async (key: string, ok: boolean) => {
      const count = failures.get(key) ?? 0;
      if (count >= 10) {
        return "blocked";
      }
      if (!ok) {
        failures.set(key, count + 1);
      }
      return ok ? "ok" : "wrong";
    },
  }),
};
const env = { GITHUB_TOKEN: "t", WRITE_PASSWORD: "pw", BLOG_REPO: "o/r", BLOG_BRANCH: "blog", PASSKEYS: passkeys } as never;

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

afterEach(() => {
  vi.unstubAllGlobals();
  failures.clear();
});

describe("worker", () => {
  it("answers a missing setting and a spent rate limit instead of crashing", async () => {
    const bare = await worker.fetch(new Request("https://write.test/api/site", { headers: { "x-write-password": "pw" } }), {} as never);
    expect([500, 501]).toContain(bare.status);
    const spent = { ...(env as object), SOURCE_RATE: { limit: async () => ({ success: false }) } } as never;
    const limitedResponse = await worker.fetch(new Request("https://write.test/api/images"), spent);
    expect(limitedResponse.status).toBe(429);
  });

  it("says what the deployment lacks, the token first, then the password, then the repository", async () => {
    const problem = async (settings: object) =>
      ((await (await worker.fetch(new Request("https://write.test/api/config"), settings as never)).json()) as { problem?: string }).problem;
    expect(await problem({ WRITE_PASSWORD: "pw" })).toMatch(/no GITHUB_TOKEN/);
    expect(await problem({ GITHUB_TOKEN: "t", WRITE_PASSWORD: " " })).toMatch(/until WRITE_PASSWORD is set/);
    expect(await problem({ GITHUB_TOKEN: "t", WRITE_PASSWORD: "pw" })).toMatch(/No BLOG_REPO/);
    expect(await problem(env as object)).toBeUndefined();
  });

  it("answers each endpoint only by its own method, an unknown one with a 404 and anything else from the assets", async () => {
    for (const [path, method] of [
      ["/api/config", "GET"],
      ["/api/share", "POST"],
      ["/api/publish", "POST"],
      ["/api/publish/photo", "POST"],
      ["/api/images", "GET"],
      ["/api/site", "GET"],
      ["/api/source", "GET"],
      ["/api/passkey/challenge", "POST"],
      ["/api/passkey/register", "POST"],
      ["/api/passkey/login", "POST"],
      ["/api/topics", "GET"],
    ]) {
      const response = await call(path, { method: method === "GET" ? "PUT" : "GET" });
      expect([path, response.status, await response.json()]).toEqual([path, 405, { error: `Use ${method}.` }]);
    }
    expect((await call("/api/share/x", { method: "PUT" })).status).toBe(404);
    expect((await call("/api/drafts")).status).toBe(404);
    const assets = { ...(env as object), ASSETS: { fetch: async (request: Request) => new Response(new URL(request.url).pathname) } } as never;
    expect(await (await worker.fetch(new Request("https://write.test/apix"), assets)).text()).toBe("/apix");
  });

  it("asks for the password on every writing or draft-reading endpoint", async () => {
    for (const [path, method] of [
      ["/api/publish", "POST"],
      ["/api/publish/photo", "POST"],
      ["/api/site", "GET"],
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
      { files: [post], expect: [{ path: ".github/x.md", sha: "a".repeat(40) }] },
      { files: [post], expect: [{ path: post.path, sha: "nope" }] },
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
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === "/graphql" && String(init?.body).includes("oid")) {
        return Response.json({
          data: { repository: { files: { entries: ["a.webp", "b c.webp"].map((name) => ({ name, oid: name, type: "blob" })) } } },
        });
      }
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

describe("the site's posts and drafts", () => {
  it("lists both, newest first, with each title, day, pin and whether the build skips it", async () => {
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      expect(new URL(input).pathname).toBe("/graphql");
      expect(String(init?.body)).toContain("blog:src/posts");
      expect(String(init?.body)).toContain("blog:src/drafts");
      return Response.json({
        data: {
          repository: {
            d0: {
              entries: [
                { name: "2026-10-11-trip.md", object: { text: "---\ntitle: Trip\ndate: 2026-10-11 09:00 +0700\npin: 3\n---\nText" } },
                { name: "2026-10-11-late.md", object: { text: "---\ntitle: Late\ndate: 2026-10-11 20:00 +0700\npin: false\n---\n" } },
                { name: "2025-01-02-old.md", object: { text: '---\ntitle: "Old \\"one\\""\ndate: 2025-01-02\npin: true # kept\nhidden: true\n---\n' } },
                { name: "notes.txt", object: { text: "pin: 2" } },
              ],
            },
            d1: { entries: [{ name: "2026-09-01-idea.md", object: { text: "---\ntitle: Idea\n---\n" } }] },
          },
        },
      });
    });
    const response = await call("/api/site", { password: "pw" });
    expect(response.status).toBe(200);
    const { posts, drafts } = (await response.json()) as { posts: { path: string; pin: unknown; hidden: boolean; title: string; date: string }[]; drafts: { path: string }[] };
    expect(posts.map(({ path, pin, hidden, title, date }) => [path.split("/").pop(), title, date, pin, hidden])).toEqual([
      ["2026-10-11-late.md", "Late", "2026-10-11", false, false],
      ["2026-10-11-trip.md", "Trip", "2026-10-11", 3, false],
      ["2025-01-02-old.md", 'Old "one"', "2025-01-02", true, true],
    ]);
    expect(drafts.map(({ path }) => path)).toEqual(["src/drafts/2026-09-01-idea.md"]);
  });

  it("reads a pin as the blog does: a quoted number or a word is no place", () => {
    const pin = (line: string) => siteFile("src/posts/2026-01-01-x.md", `---\ntitle: X\n${line}\n---\n`).pin;
    expect([pin("pin: 2"), pin("pin: 3"), pin('pin: "true"'), pin("pin: True"), pin('pin: "2"'), pin("pin: 4"), pin("pin: yes"), pin("")]).toEqual([
      2, 3, true, true, false, false, false, false,
    ]);
    expect(siteFile("src/posts/x.md", "No front matter\npin: 2\n").pin).toBe(false);
    expect([pin('pin: "true" # kept'), pin("pin:\n  2"), pin("pin: 02"), pin("pin: 3.0"), pin("pin: 2 # second"), pin("pin: 0x3")]).toEqual([true, 2, 2, 3, 2, 3]);
  });

  it("finds the front matter where the app does", () => {
    const title = (text: string) => siteFile("src/posts/2026-01-01-x.md", text).title;
    expect(title("\ufeff---\r\ntitle: Trip\r\n---\r\nText")).toBe("Trip");
    expect(title("---\ntitle: Trip\n---")).toBe("Trip");
    expect(title("---\ntitle: Trip\n---  \nText")).toBe("Trip");
    expect(title("--- \ntitle: Trip\n---\nText")).toBe("");
    expect(title("---\n---\ntitle: Trip\n")).toBe("");
    expect(title("\ufeff\ufeff---\ntitle: Trip\n---\n")).toBe("");
  });

  it("orders by the time written, in the site's zone when none is given", () => {
    const time = (date: string) => siteFile("src/posts/2026-01-01-x.md", `---\ndate: ${date}\n---\n`).time;
    expect(time("2026-01-01 10:00")).toBe(time("2026-01-01T03:00:00Z"));
    expect(time("2026-01-01 10:00 +0800")).toBe(time("2026-01-01 09:00 +0700"));
    expect(siteFile("src/posts/2026-01-01-x.md", "---\ntitle: X\n---\n").time).toBe(time("2026-01-01"));
  });
});

describe("worker hardening", () => {
  const from = (ip: string, password: string) =>
    worker.fetch(new Request("https://write.test/api/site", { headers: { "x-write-password": password, "cf-connecting-ip": ip } }), env);

  it("stops guessing the password after ten misses from one connection, the right one included", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ data: { repository: { d0: null } } }));
    for (let miss = 0; miss < 10; miss++) {
      expect((await from("1.1.1.1", `guess-${miss}`)).status).toBe(401);
    }
    expect((await from("1.1.1.1", "guess")).status).toBe(429);
    expect((await from("1.1.1.1", "pw")).status).toBe(429);
    expect((await from("2.2.2.2", "pw")).status).toBe(200);
  });

  it("sends the security headers on pages and answers alike", async () => {
    const page = await worker.fetch(new Request("https://write.test/"), {
      ...(env as object),
      ASSETS: { fetch: async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } }) },
    } as never);
    const answer = await worker.fetch(new Request("https://write.test/api/config"), env);
    for (const response of [page, answer]) {
      expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
    }
  });

  it("gives every page a fresh script nonce for the script Cloudflare injects, and no answer one", async () => {
    const assets = {
      ...(env as object),
      ASSETS: { fetch: async () => new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }) },
    } as never;
    const nonce = async () =>
      /script-src 'self' 'nonce-([A-Za-z0-9+/=]{24})'/.exec(
        (await worker.fetch(new Request("https://write.test/"), assets)).headers.get("content-security-policy") ?? "",
      )?.[1];
    const first = await nonce();
    expect(first).toBeTruthy();
    expect(await nonce()).not.toBe(first);
    const answer = await worker.fetch(new Request("https://write.test/api/config"), env);
    expect(answer.headers.get("content-security-policy")).not.toContain("nonce-");
  });

  it("hands the share's owner a key and passes it on when the share ends", async () => {
    const seen: Request[] = [];
    const share = {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (input: string, init?: RequestInit) => {
          seen.push(new Request(input, init));
          return new Response(null, { status: 204 });
        },
      }),
    };
    const shareEnv = { ...(env as object), SHARE: share } as never;
    const created = await worker.fetch(new Request("https://write.test/api/share", { method: "POST", body: new Uint8Array([0, 0]) }), shareEnv);
    const { token, owner } = (await created.json()) as { token: string; owner: string };
    expect(owner).toMatch(/^[0-9a-f]{32}$/);
    expect(seen[0].headers.get("x-share-owner")).toBe(owner);
    await worker.fetch(new Request(`https://write.test/api/share/${token}`, { method: "DELETE", headers: { "x-share-owner": owner } }), shareEnv);
    expect(seen[1].method).toBe("DELETE");
    expect(seen[1].headers.get("x-share-owner")).toBe(owner);
  });
});

