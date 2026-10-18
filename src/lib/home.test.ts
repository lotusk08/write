import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pin } from "../../shared/pin.ts";
import { homePlaces, homeTop, pinChanges, publishPins, setPin, swapChanges } from "./home.ts";
import { newPostMeta } from "./draft.ts";
import { parsePost } from "./import.ts";
import { buildPostFile } from "./markdown.ts";

const posts = (...pins: Pin[]) => pins.map((pin, index) => ({ path: `p${index}`, pin }));
const paths = (list: { path: string }[]) => list.map((post) => post.path);

afterEach(() => vi.unstubAllGlobals());

describe("the home page's places", () => {
  it("puts the newest first, then the places pins name, then true pins in the places left", () => {
    expect(paths(homeTop(posts(false, false, false, false)))).toEqual(["p0", "p1", "p2"]);
    expect(paths(homeTop(posts(false, false, false, 3)))).toEqual(["p0", "p1", "p3"]);
    expect(paths(homeTop(posts(false, false, true, 2)))).toEqual(["p0", "p3", "p2"]);
    expect(paths(homeTop(posts(2, false, true, true, true)))).toEqual(["p0", "p2", "p3"]);
    expect(paths(homeTop(posts(false, 2, 2, 3)))).toEqual(["p0", "p1", "p3"]);
    expect([...homePlaces(posts(false, 2, 2, false)).keys()]).toEqual([2]);
  });

  const blog = resolve(process.env.BLOG_DIR ?? join(import.meta.dirname, "../../../stevehoang.com"), "src/logics/utils.ts");

  it.skipIf(!existsSync(blog))("agrees with the blog's own homeOrder", async (context) => {
    const { homeOrder } = (await import(/* @vite-ignore */ blog)) as { homeOrder?: <T extends { pin: Pin }>(list: T[]) => T[] };
    if (!homeOrder) {
      context.skip();
      return;
    }
    const values: Pin[] = [false, true, 2, 3];
    for (let seed = 0; seed < 4 ** 6; seed++) {
      const list = posts(...Array.from({ length: 6 }, (_, at) => values[Math.floor(seed / 4 ** at) % 4]));
      expect(paths(homeTop(list)), JSON.stringify(list)).toEqual(paths(homeOrder(list).slice(0, 3)));
    }
  });
});

describe("pinning from the list", () => {
  it("moves the one standing at a place to the other when it is free, and unpins it when it is not", () => {
    const free = posts(false, 2, false);
    expect([...pinChanges(free, free[1], 2)]).toEqual([]);
    expect([...pinChanges(free, free[2], 2)]).toEqual([["p2", 2], ["p1", 3]]);
    const full = posts(false, 2, 3, false);
    expect([...pinChanges(full, full[3], 2)]).toEqual([["p3", 2], ["p1", false]]);
    expect([...pinChanges(full, full[2], 2)]).toEqual([["p2", 2], ["p1", 3]]);
    expect([...pinChanges(full, full[1], false)]).toEqual([["p1", false]]);
  });

  it("moves nobody for the newest post, which is first whatever its pin", () => {
    const list = posts(false, 2, 3);
    expect([...pinChanges(list, list[0], 2)]).toEqual([["p0", 2]]);
  });

  it("swaps the two places, or moves a lone pin to the other one", () => {
    expect([...swapChanges(posts(false, 2, true))]).toEqual([["p1", 3], ["p2", 2]]);
    expect([...swapChanges(posts(false, false, 2))]).toEqual([["p2", 3]]);
    expect([...swapChanges(posts(false, false, false))]).toEqual([]);
  });
});

describe("a post's pin line", () => {
  const post = "---\ntitle: Trip\ndate: 2026-10-11 09:00 +0700\ntags:\n  - travel\npin: false\ntoc: false\n---\nText with pin: true\n";

  it("is rewritten in place and nothing else moves", () => {
    expect(setPin(post, 2)).toBe(post.replace("pin: false", "pin: 2"));
    expect(setPin(post.replace("pin: false", "pin: true # top"), false)).toBe(post);
    expect(setPin(post.replaceAll("\n", "\r\n"), 3)).toBe(post.replace("pin: false", "pin: 3").replaceAll("\n", "\r\n"));
    expect(setPin(`\ufeff${post}`, 3)).toBe(`\ufeff${post.replace("pin: false", "pin: 3")}`);
  });

  it("is written where the app writes it when the post has none", () => {
    expect(setPin(post.replace("pin: false\n", ""), 3)).toBe(post.replace("pin: false", "pin: 3"));
    expect(setPin("---\ntitle: X\n---\nBody\n", true)).toBe("---\ntitle: X\npin: true\n---\nBody\n");
    expect(setPin("No front matter\n", 2)).toBeNull();
  });

  it("is read back and written as the blog takes it", () => {
    for (const [line, pin] of [["pin: 2", 2], ["pin: 3", 3], ["pin: true", true], ['pin: "2"', false], ["pin: 4", false]] as const) {
      const meta = parsePost(post.replace("pin: false", line)).meta;
      expect(meta.pin, line).toBe(pin);
      expect(buildPostFile({ ...newPostMeta(), ...meta }, { type: "doc", content: [] })).toContain(`\npin: ${pin}\n`);
    }
  });
});

describe("publishPins", () => {
  const sources: Record<string, string> = {
    "src/posts/a.md": "---\ntitle: A\npin: 2\ntoc: false\n---\nA\n",
    "src/posts/b.md": "---\ntitle: B\npin: false\ntoc: false\n---\nB\n",
  };
  const shown = new Map<string, { title: string; pin: Pin }>([
    ["src/posts/a.md", { title: "A", pin: 2 }],
    ["src/posts/b.md", { title: "B", pin: false }],
  ]);

  function site() {
    const sent: { message: string; files: { path: string; contentBase64: string }[]; expect: unknown }[] = [];
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input, "https://write.test");
      if (url.pathname === "/api/source") {
        const path = url.searchParams.get("path")!;
        return Response.json({ path, branch: "blog", markdown: sources[path], sha: path.endsWith("a.md") ? "a".repeat(40) : "b".repeat(40) });
      }
      sent.push(JSON.parse(String(init?.body)) as (typeof sent)[number]);
      return Response.json({ commitUrl: "https://github.com/o/r/commit/c", shas: { "src/posts/a.md": "c".repeat(40), "src/posts/b.md": "d".repeat(40) } });
    });
    return sent;
  }

  it("writes only the pin lines, in one commit guarded by the shas it read", async () => {
    const sent = site();
    const { written } = await publishPins(new Map<string, Pin>([["src/posts/b.md", 2], ["src/posts/a.md", 3]]), shown, "pw");
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toBe("docs(post): B pinned 2nd, A pinned 3rd");
    expect(sent[0].expect).toEqual([
      { path: "src/posts/b.md", sha: "b".repeat(40) },
      { path: "src/posts/a.md", sha: "a".repeat(40) },
    ]);
    const text = (index: number) => new TextDecoder().decode(Uint8Array.from(atob(sent[0].files[index].contentBase64), (char) => char.charCodeAt(0)));
    expect(text(0)).toBe(sources["src/posts/b.md"].replace("pin: false", "pin: 2"));
    expect(text(1)).toBe(sources["src/posts/a.md"].replace("pin: 2", "pin: 3"));
    expect(written).toEqual([
      { path: "src/posts/b.md", pin: 2, was: "b".repeat(40), sha: "d".repeat(40) },
      { path: "src/posts/a.md", pin: 3, was: "a".repeat(40), sha: "c".repeat(40) },
    ]);
  });

  it("sends nothing when a pin on the site is no longer the one the list showed", async () => {
    const sent = site();
    const stale = new Map(shown).set("src/posts/a.md", { title: "A", pin: false });
    await expect(publishPins(new Map<string, Pin>([["src/posts/a.md", 3]]), stale, "pw")).rejects.toThrow("changed on the site");
    expect(sent).toHaveLength(0);
  });
});
