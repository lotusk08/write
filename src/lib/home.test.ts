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

  it("unpins an older post naming the same place, which would otherwise take it", () => {
    const named = posts(false, 2, 2, false);
    expect([...pinChanges(named, named[3], 2)]).toEqual([["p3", 2], ["p1", 3], ["p2", false]]);
    const twice = posts(false, 2, 2, 3);
    expect([...swapChanges(twice)]).toEqual([["p1", 3], ["p3", 2], ["p2", false]]);
    const outranked = posts(false, 2, 2, false);
    expect([...pinChanges(outranked, outranked[2], 2)]).toEqual([["p2", 2], ["p1", 3]]);
  });

  const every = (count: number) =>
    Array.from({ length: 4 ** count }, (_, seed) => posts(...Array.from({ length: count }, (_, at) => ([false, true, 2, 3] as Pin[])[Math.floor(seed / 4 ** at) % 4])));
  const applied = (list: ReturnType<typeof posts>, changes: Map<string, Pin>) =>
    list.map((post) => ({ ...post, pin: changes.has(post.path) ? changes.get(post.path)! : post.pin }));
  const standing = (list: ReturnType<typeof posts>) => new Map([...homePlaces(list)].map(([place, post]) => [place, post.path]));

  it("puts the post where it was asked, over every pin of six posts", () => {
    for (const list of every(6)) {
      for (const post of list.slice(1)) {
        for (const place of [2, 3] as const) {
          const before = standing(list);
          const changes = pinChanges(list, post, place);
          const after = standing(applied(list, changes));
          expect(changes.size, "two places, two posts, and the duplicates left naming them").toBeLessThanOrEqual(list.length);
          const label = `${JSON.stringify(list.map((each) => each.pin))} ${post.path} → ${place}`;
          expect(after.get(place), label).toBe(post.path);
          const holder = before.get(place);
          const other = place === 2 ? 3 : 2;
          if (holder && holder !== post.path && (!before.get(other) || before.get(other) === post.path)) {
            expect(after.get(other), label).toBe(holder);
          } else if (before.get(other) !== post.path) {
            expect(after.get(other), label).toBe(before.get(other));
          }
        }
      }
    }
  });

  it("trades the two places, over every pin of six posts", () => {
    for (const list of every(6)) {
      const before = standing(list);
      const after = standing(applied(list, swapChanges(list)));
      expect([after.get(3), after.get(2)], JSON.stringify(list.map((each) => each.pin))).toEqual([before.get(2), before.get(3)]);
    }
  });
});

describe("a post's pin line", () => {
  const post = "---\ntitle: Trip\ndate: 2026-10-11 09:00 +0700\ntags:\n  - travel\npin: false\ntoc: false\n---\nText with pin: true\n";

  it("is rewritten in place and nothing else moves", () => {
    expect(setPin(post, 2)).toBe(post.replace("pin: false", "pin: 2"));
    expect(setPin(post.replace("pin: false", "pin: true # top"), 2)).toBe(post.replace("pin: false", "pin: 2 # top"));
    expect(setPin(post.replace("pin: false", 'pin: "true"  # top'), 3)).toBe(post.replace("pin: false", "pin: 3  # top"));
    expect(setPin(post.replaceAll("\n", "\r\n"), 3)).toBe(post.replace("pin: false", "pin: 3").replaceAll("\n", "\r\n"));
    expect(setPin(`\ufeff${post}`, 3)).toBe(`\ufeff${post.replace("pin: false", "pin: 3")}`);
  });

  it("is written where the app writes it when the post has none", () => {
    expect(setPin(post.replace("pin: false\n", ""), 3)).toBe(post.replace("pin: false", "pin: 3"));
    expect(setPin("---\ntitle: X\n---\nBody\n", true)).toBe("---\ntitle: X\npin: true\n---\nBody\n");
    expect(setPin("No front matter\n", 2)).toBeNull();
  });

  it("is not written where the editor reads no front matter: an empty one, or one opened by --- and spaces", () => {
    expect(setPin("---\ntitle: X\n---", 3)).toBe("---\ntitle: X\npin: 3\n---");
    for (const text of ["---\n---\nBody\n", "---  \ntitle: X\n---\nBody\n", "\ufeff\ufeff---\ntitle: X\n---\n"]) {
      expect(setPin(text, 2), JSON.stringify(text)).toBeNull();
    }
  });

  it("is read back and written as the blog takes it", () => {
    for (const [line, pin] of [["pin: 2", 2], ["pin: 3", 3], ["pin: true", true], ['pin: "2"', false], ["pin: 4", false], ["pin: 02", 2], ["pin: 3.0", 3]] as const) {
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
  const file = (path: string, title: string, pin: Pin, time: number) => ({ path, title, date: "", time, pin, hidden: false });
  const shown = [file("src/posts/n.md", "N", false, 3), file("src/posts/a.md", "A", 2, 2), file("src/posts/b.md", "B", false, 1)];

  function site(listed = shown) {
    const sent: { message: string; files: { path: string; contentBase64: string }[]; expect: unknown }[] = [];
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input, "https://write.test");
      if (url.pathname === "/api/site") {
        return Response.json({ posts: listed, drafts: [] });
      }
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

  it("sends nothing when a file's pin is no longer the one the list showed", async () => {
    const stale = shown.map((post) => (post.path === "src/posts/a.md" ? { ...post, pin: false as Pin } : post));
    const sent = site(stale);
    await expect(publishPins(new Map<string, Pin>([["src/posts/a.md", 3]]), stale, "pw")).rejects.toThrow("A changed on the site");
    expect(sent).toHaveLength(0);
  });

  it("sends nothing when the site's list moved since it was read: a post published, or a pin changed", async () => {
    for (const now of [[file("src/posts/new.md", "New", false, 4), ...shown], shown.map((post) => (post.path === "src/posts/b.md" ? { ...post, pin: 3 as Pin } : post))]) {
      const sent = site(now);
      await expect(publishPins(new Map<string, Pin>([["src/posts/a.md", 3]]), shown, "pw")).rejects.toThrow("The site changed since the list was read.");
      expect(sent).toHaveLength(0);
    }
  });
});
