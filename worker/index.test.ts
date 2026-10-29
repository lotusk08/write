import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const { default: worker, siteFile } = await import("./index.ts");
const { challengeExpiry, issueChallenge } = await import("./passkeys.ts");

const failures = new Map<string, number>();
const spent = new Set<string>();
const keys = new Map<string, { key: ArrayBuffer; alg: number; counter: number }>();
const passkeys = {
  idFromName: () => "owner",
  get: () => ({
    credentialIds: async () => ["cred-1"],
    credential: async (id: string) => keys.get(id) ?? null,
    touch: async () => undefined,
    spend: async (challenge: string) => !spent.has(challenge) && Boolean(spent.add(challenge)),
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
  spent.clear();
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
      ["/api/media", "GET"],
      ["/api/media/delete", "POST"],
      ["/api/media/fetch", "GET"],
      ["/api/media/start", "POST"],
      ["/api/media/part", "PUT"],
      ["/api/media/complete", "POST"],
      ["/api/media/abort", "POST"],
      ["/api/media/poster", "PUT"],
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
      ["/api/media", "GET"],
      ["/api/media/delete", "POST"],
      ["/api/media/start", "POST"],
      ["/api/media/part", "PUT"],
      ["/api/media/complete", "POST"],
      ["/api/media/abort", "POST"],
      ["/api/media/poster", "PUT"],
    ]) {
      expect((await call(path, { method, body: method === "GET" ? undefined : "{}" })).status).toBe(401);
      failures.clear();
      expect((await call(path, { method, password: "wrong", body: method === "GET" ? undefined : "{}" })).status).toBe(401);
    }
  });

  it("refuses paths and entries outside what a publish may touch", async () => {
    const photo = { path: "public/assets/img/post/a.webp", sha: "a".repeat(40) };
    for (const body of [
      { files: [{ ...post, path: "src/posts/../../.github/workflows/x.yml" }] },
      { files: [{ ...post, path: "src/posts/%2e%2e/x.md" }] },
      { files: [{ ...post, path: ".github/workflows/x.yml" }] },
      { files: [{ path: photo.path, sha: "not-a-sha" }] },
      { files: ["src/posts/x.md"] },
      { files: [5] },
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

describe("passkey challenges", () => {
  const challenge = (query = "", password?: string) =>
    worker.fetch(
      new Request(`https://write.test/api/passkey/challenge${query}`, { method: "POST", headers: password ? { "x-write-password": password } : {} }),
      env,
    );

  it("are signed, not kept, so no number asked for pushes the owner's out", async () => {
    const asked = await Promise.all(Array.from({ length: 60 }, () => challenge()));
    const first = (await asked[0].json()) as { challenge: string; credentials: string[] };
    expect(first.credentials).toEqual(["cred-1"]);
    expect(await challengeExpiry("pw", "login", first.challenge)).toBeGreaterThan(Date.now());
  });

  it("sign in once each, by a passkey's signature over the challenge the Worker signed", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    keys.set("cred-1", { key: (await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer, alg: -7, counter: 0 });
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const login = async (purpose = "") => {
      const { challenge: given } = (await (await challenge(purpose, purpose ? "pw" : undefined)).json()) as { challenge: string };
      const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: given, origin: "https://write.test" }));
      const authenticatorData = new Uint8Array(37);
      authenticatorData.set(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("write.test"))));
      authenticatorData[32] = 0x05;
      const signed = new Uint8Array([...authenticatorData, ...new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataJSON))]);
      const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, signed));
      const integer = (half: Uint8Array) => (half[0] & 0x80 ? [0x02, 33, 0, ...half] : [0x02, 32, ...half]);
      const parts = [...integer(raw.slice(0, 32)), ...integer(raw.slice(32))];
      const body = { id: "cred-1", clientDataJSON: b64(clientDataJSON), authenticatorData: b64(authenticatorData), signature: b64(new Uint8Array([0x30, parts.length, ...parts])) };
      const send = () => worker.fetch(new Request("https://write.test/api/passkey/login", { method: "POST", body: JSON.stringify(body) }), env);
      return [await send(), await send()];
    };
    const [first, replayed] = await login();
    expect(first.status).toBe(200);
    expect(((await first.json()) as { session?: string }).session).toMatch(/^v1\./);
    expect(replayed.status).toBe(401);
    expect((await login("?for=register"))[0].status).toBe(401);
    keys.clear();
  });

  it("to save a passkey only after the password, and each for its own purpose, once, within five minutes", async () => {
    expect((await challenge("?for=register")).status).toBe(401);
    expect((await challenge("?for=register", "wrong")).status).toBe(401);
    const saving = (await (await challenge("?for=register", "pw")).json()) as { challenge: string };
    expect(await challengeExpiry("pw", "register", saving.challenge)).not.toBeNull();
    expect(await challengeExpiry("pw", "login", saving.challenge)).toBeNull();
    expect(await challengeExpiry("other password", "register", saving.challenge)).toBeNull();
    const old = await issueChallenge("pw", "login", Date.now() - 6 * 60 * 1000);
    expect(await challengeExpiry("pw", "login", old)).toBeNull();
    const forged = saving.challenge.slice(0, -4) + (saving.challenge.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(await challengeExpiry("pw", "register", forged)).toBeNull();
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

describe("video uploads", () => {
  const fingerprint = "ab".repeat(32);
  const objects = new Map<string, { bytes: Uint8Array; type?: string; cache?: string; meta?: Record<string, string> }>();
  const pending = new Map<string, { key: string; parts: Map<number, Uint8Array>; type?: string; meta?: Record<string, string> }>();
  const bucket = {
    head: async (key: string) => (objects.has(key) ? { size: objects.get(key)!.bytes.byteLength, customMetadata: objects.get(key)!.meta } : null),
    list: async () => ({
      truncated: false,
      objects: [...objects].map(([key, { bytes }], index) => ({ key, size: bytes.byteLength, uploaded: new Date(Date.UTC(2026, 9, 1 + index)) })),
    }),
    delete: async (keys: string[]) => keys.forEach((key) => objects.delete(key)),
    put: async (key: string, bytes: Uint8Array, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }) => {
      objects.set(key, { bytes, type: options?.httpMetadata?.contentType, cache: options?.httpMetadata?.cacheControl });
    },
    createMultipartUpload: async (key: string, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) => {
      const uploadId = `up-${pending.size + 1}`;
      pending.set(uploadId, { key, parts: new Map(), type: options?.httpMetadata?.contentType, meta: options?.customMetadata });
      return { uploadId };
    },
    resumeMultipartUpload: (key: string, uploadId: string) => {
      const upload = pending.get(uploadId);
      if (upload?.key !== key) {
        throw new Error("No such upload.");
      }
      return {
        uploadPart: async (partNumber: number, bytes: Uint8Array) => {
          upload.parts.set(partNumber, bytes);
          return { partNumber, etag: `e${partNumber}` };
        },
        complete: async (parts: { partNumber: number; etag: string }[]) => {
          const chunks = parts.map(({ partNumber }) => upload.parts.get(partNumber)!);
          const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
          chunks.reduce((offset, chunk) => (bytes.set(chunk, offset), offset + chunk.byteLength), 0);
          objects.set(key, { bytes, type: upload.type, meta: upload.meta });
          pending.delete(uploadId);
          return { size: bytes.byteLength };
        },
        abort: async () => void pending.delete(uploadId),
      };
    },
  };
  const mediaEnv = { ...(env as object), MEDIA: bucket, MEDIA_URL: "https://media.test/" } as never;
  const send = (path: string, init: RequestInit = {}) =>
    worker.fetch(new Request(`https://write.test${path}`, { ...init, headers: { "x-write-password": "pw", ...(init.headers as object) } }), mediaEnv);
  const start = (body: object) => send("/api/media/start", { method: "POST", body: JSON.stringify(body) });

  afterEach(() => {
    objects.clear();
    pending.clear();
  });

  it("says where videos are served only where the bucket and its address are both set", async () => {
    const config = async (settings: object) => ((await (await worker.fetch(new Request("https://write.test/api/config"), settings as never)).json()) as { media?: string }).media;
    expect(await config(mediaEnv as object)).toBe("https://media.test");
    expect(await config({ ...(env as object), MEDIA: bucket })).toBeUndefined();
    expect(await config({ ...(env as object), MEDIA_URL: "https://media.test" })).toBeUndefined();
    const refused = await worker.fetch(new Request("https://write.test/api/media/start", { method: "POST", headers: { "x-write-password": "pw" }, body: "{}" }), env);
    expect(refused.status).toBe(501);
  });

  it("sends a video in parts under a name of words and its hash, then keeps one copy of it", async () => {
    const started = await start({ name: "Ngày tuyển hôn!", fingerprint, size: 7, type: "video/mp4" });
    const { key, url, upload } = (await started.json()) as { key: string; url: string; upload: string };
    expect(key).toBe(`video/ng-y-tuy-n-h-n-${fingerprint.slice(0, 12)}.mp4`);
    expect(url).toBe(`https://media.test/${key}`);
    const part = async (n: number, body: string) =>
      (await (await send(`/api/media/part?key=${key}&upload=${upload}&part=${n}`, { method: "PUT", body })).json()) as { partNumber: number; etag: string };
    const parts = [await part(1, "abcd"), await part(2, "efg")];
    const done = await send("/api/media/complete", { method: "POST", body: JSON.stringify({ key, upload, parts }) });
    expect(await done.json()).toEqual({ key, url, size: 7 });
    expect(new TextDecoder().decode(objects.get(key)!.bytes)).toBe("abcdefg");
    expect(objects.get(key)!.type).toBe("video/mp4");
    const again = (await (await start({ name: "Ngày tuyển hôn!", fingerprint, size: 9, type: "video/mp4" })).json()) as { upload?: string };
    expect(again.upload).toBeUndefined();
  });

  it("keeps the still beside its video and stops an upload when asked", async () => {
    const { key, upload } = (await (await start({ name: "clip", fingerprint, size: 3, type: "video/webm" })).json()) as { key: string; upload: string };
    const still = await send(`/api/media/poster?key=${key}`, { method: "PUT", headers: { "content-type": "image/webp" }, body: "img" });
    expect(await still.json()).toEqual({ key: key.replace(".webm", ".webp"), url: `https://media.test/${key.replace(".webm", ".webp")}` });
    expect((await send("/api/media/abort", { method: "POST", body: JSON.stringify({ key, upload }) })).status).toBe(200);
    expect(pending.size).toBe(0);
  });

  it("refuses what is not a video upload of the app's", async () => {
    for (const body of [
      { name: "x", fingerprint: "nothex", size: 1, type: "video/mp4" },
      { name: "x", fingerprint, size: 1, type: "video/quicktime" },
      { name: "x", fingerprint, size: 0, type: "video/mp4" },
      { name: "x", fingerprint, size: 5 * 1024 ** 3, type: "video/mp4" },
    ]) {
      expect((await start(body)).status, JSON.stringify(body)).toBe(400);
    }
    for (const query of ["key=../x.mp4&upload=u&part=1", "key=video/x-abababababab.mp4&upload=u&part=0", "key=video/x.mp4&upload=u&part=1"]) {
      expect((await send(`/api/media/part?${query}`, { method: "PUT", body: "a" })).status, query).toBe(400);
    }
    const key = `video/x-${fingerprint.slice(0, 12)}.mp4`;
    expect((await send(`/api/media/part?key=${key}&upload=u&part=1`, { method: "PUT", body: "" })).status).toBe(400);
    expect((await send(`/api/media/poster?key=${key}`, { method: "PUT", headers: { "content-type": "image/svg+xml" }, body: "<svg/>" })).status).toBe(400);
    expect((await send("/api/media/complete", { method: "POST", body: JSON.stringify({ key, upload: "u", parts: [] }) })).status).toBe(400);
  });

  const TRUNCATED = "\u0000truncated";
  function fakeSite(files: Record<string, string>) {
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const blobs = new Map<string, string>();
    let tree: { path: string; sha: string | null }[] = [];
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (url.pathname === "/graphql") {
        const variables = body.variables as Record<string, string>;
        const entriesIn = (dir: string) => {
          const names = new Set(Object.keys(files).filter((path) => path.startsWith(`${dir}/`)).map((path) => path.slice(dir.length + 1).split("/")[0]));
          return [...names].map((name): unknown =>
            `${dir}/${name}` in files
              ? { name, object: files[`${dir}/${name}`] === TRUNCATED ? { text: "", isTruncated: true } : { text: files[`${dir}/${name}`] } }
              : { name, object: { entries: entriesIn(`${dir}/${name}`) } },
          );
        };
        return reply({
          data: {
            repository: Object.fromEntries(
              Object.entries(variables)
                .filter(([name]) => name !== "owner" && name !== "name")
                .map(([name, expression]) => {
                  const entries = entriesIn(expression.replace(/^[^:]*:/, ""));
                  return [name, entries.length ? { entries } : null];
                }),
            ),
          },
        });
      }
      const contents = /\/contents\/(.+)$/.exec(url.pathname)?.[1];
      if (contents) {
        const path = decodeURIComponent(contents);
        return path in files ? reply({ content: btoa(files[path]), encoding: "base64", sha: `sha:${path}` }) : reply({ message: "Not Found" }, 404);
      }
      if (url.pathname.endsWith("/git/ref/heads/blog")) {
        return reply({ object: { sha: "head" } });
      }
      if (url.pathname.endsWith("/git/commits/head")) {
        return reply({ tree: { sha: "base" } });
      }
      if (url.pathname.endsWith("/git/blobs")) {
        blobs.set(`blob${blobs.size}`, atob(body.content));
        return reply({ sha: `blob${blobs.size - 1}` });
      }
      if (url.pathname.endsWith("/git/trees")) {
        tree = body.tree;
        return reply({ sha: "tree" });
      }
      if (url.pathname.endsWith("/git/commits")) {
        return reply({ sha: "commit", html_url: "https://github.com/commit" });
      }
      if (url.pathname.endsWith("/git/refs/heads/blog")) {
        for (const { path, sha } of tree) {
          if (sha === null) {
            delete files[path];
          } else if (blobs.has(sha)) {
            files[path] = blobs.get(sha)!;
          }
        }
        return reply({});
      }
      return reply({ message: `unexpected ${url.pathname}` }, 500);
    });
  }
  const stored = (...keys: string[]) => keys.forEach((key) => objects.set(key, { bytes: new Uint8Array(4) }));
  const keyOf = (name: string, hex: string) => `video/${name}-${hex.repeat(12)}.mp4`;
  const [old, shared, fresh, dropped] = [keyOf("old", "a"), keyOf("shared", "b"), keyOf("new", "c"), keyOf("draft", "d")];
  const player = (key: string) => `<EmbedVideo src="https://media.test/${key}" />`;

  it("lists every video with its still and the files that use it, newest first", async () => {
    stored(old, old.replace(".mp4", ".webp"), shared);
    fakeSite({ "src/posts/2026-10-01-a.md": player(shared), "src/drafts/b.md": `${player(shared)}\n${player(old)}` });
    const { videos } = (await (await send("/api/media")).json()) as { videos: { key: string; poster: string | null; used: string[] }[] };
    expect(videos.map(({ key, poster, used }) => [key, poster, used])).toEqual([
      [shared, null, ["src/posts/2026-10-01-a.md", "src/drafts/b.md"]],
      [old, `https://media.test/${old.replace(".mp4", ".webp")}`, ["src/drafts/b.md"]],
    ]);
  });

  it("deletes only the videos no file uses, with their stills", async () => {
    stored(old, old.replace(".mp4", ".webp"), shared);
    fakeSite({ "src/posts/2026-10-01-a.md": "Words", "src/pages/about.md": player(shared) });
    const response = await send("/api/media/delete", { method: "POST", body: JSON.stringify({ keys: [old, shared] }) });
    expect(await response.json()).toEqual({ deleted: [old], kept: [{ key: shared, used: ["src/pages/about.md"] }] });
    expect([...objects.keys()]).toEqual([shared]);
    expect((await send("/api/media/delete", { method: "POST", body: JSON.stringify({ keys: ["video/../x.mp4"] }) })).status).toBe(400);
  });

  it("deletes nothing when a file on the site is too large for GitHub to give whole", async () => {
    stored(old);
    fakeSite({ "src/posts/2026-10-01-a.md": "Words", "src/posts/2026-10-02-long.md": TRUNCATED });
    expect((await send("/api/media/delete", { method: "POST", body: JSON.stringify({ keys: [old] }) })).ok).toBe(false);
    expect([...objects.keys()]).toEqual([old]);
  });

  it("deletes nothing when the site's posts cannot be found, as on a mistyped branch", async () => {
    stored(old, shared);
    fakeSite({ "src/pages/about.md": player(shared) });
    expect((await send("/api/media/delete", { method: "POST", body: JSON.stringify({ keys: [old] }) })).ok).toBe(false);
    expect((await send("/api/media")).ok).toBe(false);
    expect([...objects.keys()]).toEqual([old, shared]);
  });

  it("removes after a publish the videos the post dropped that nothing else uses", async () => {
    const local = keyOf("local", "e");
    const nested = keyOf("nested", "f");
    stored(old, old.replace(".mp4", ".webp"), shared, fresh, dropped, local, nested);
    const path = "src/posts/2026-10-11-trip.md";
    fakeSite({
      [path]: `${player(old)}\n${player(shared)}\n${player(local)}\n${player(nested)}`,
      "src/posts/2026-10-01-other.md": player(shared),
      "src/pages/talks/2024/index.md": player(nested),
    });
    const text = `${player(fresh)}\n${player(shared)}`;
    const response = await send("/api/publish", {
      method: "POST",
      body: JSON.stringify({ message: "m", files: [{ path, contentBase64: btoa(text) }], retire: [dropped, shared, fresh], keep: [local] }),
    });
    expect(((await response.json()) as { retired?: string[] }).retired?.sort()).toEqual([dropped, old].sort());
    expect([...objects.keys()].sort()).toEqual([fresh, shared, local, nested].sort());
    for (const extra of [{ retire: ["video/x.mp4"] }, { keep: ["../x"] }]) {
      const refused = await send("/api/publish", { method: "POST", body: JSON.stringify({ message: "m", files: [{ path, contentBase64: btoa(text) }], ...extra }) });
      expect(refused.status).toBe(400);
    }
  });

  it("removes only what the app retires when it cannot vouch for this device's drafts", async () => {
    stored(old, dropped);
    const path = "src/posts/2026-10-11-trip.md";
    fakeSite({ [path]: player(old) });
    const response = await send("/api/publish", {
      method: "POST",
      body: JSON.stringify({ message: "m", files: [{ path, contentBase64: btoa("Words") }], retire: [dropped], sweep: false }),
    });
    expect(((await response.json()) as { retired?: string[] }).retired).toEqual([dropped]);
    expect([...objects.keys()]).toEqual([old]);
    const refused = await send("/api/publish", { method: "POST", body: JSON.stringify({ message: "m", files: [{ path, contentBase64: btoa("Words") }], sweep: "no" }) });
    expect(refused.status).toBe(400);
  });

  it("reads no more of the site for a publish that leaves no video", async () => {
    const path = "src/posts/2026-10-11-plain.md";
    fakeSite({ [path]: "Words" });
    const asked: string[] = [];
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => (asked.push(new URL(input).pathname), real(input, init)));
    expect((await send("/api/publish", { method: "POST", body: JSON.stringify({ message: "m", files: [{ path, contentBase64: btoa("More words") }] }) })).status).toBe(200);
    expect(asked.filter((pathname) => pathname === "/graphql")).toEqual([]);
  });

  it("fetches a video shared from Dropbox from Dropbox's file host, and nothing else", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      asked.push(input);
      return new Response(input.includes("doc.pdf") ? "%PDF" : "movie", { headers: { "content-type": input.includes("doc.pdf") ? "application/pdf" : "video/quicktime", "content-length": "5" } });
    });
    const fetched = (url: string) => send(`/api/media/fetch?${new URLSearchParams({ url })}`);
    const video = await fetched("https://www.dropbox.com/scl/fi/abc/clip.mov?rlkey=k&st=s&dl=0");
    expect([video.status, video.headers.get("content-type"), await video.text()]).toEqual([200, "video/quicktime", "movie"]);
    expect(asked).toEqual(["https://dl.dropboxusercontent.com/scl/fi/abc/clip.mov?rlkey=k&st=s"]);
    expect((await fetched("https://www.dropbox.com/scl/fi/abc/doc.pdf?rlkey=k&dl=0")).status).toBe(400);
    for (const url of ["https://evil.example/scl/fi/a/b.mp4", "http://www.dropbox.com/scl/fi/a/b.mp4", "https://dropbox.com.evil.example/scl/fi/a.mp4"]) {
      expect((await fetched(url)).status, url).toBe(400);
    }
    expect(asked).toHaveLength(2);
  });
});
