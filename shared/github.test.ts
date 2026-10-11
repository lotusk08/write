import { afterEach, describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "./base64.ts";
import { commitFiles } from "./github.ts";

type Tree = { path: string; sha: string | null }[];

function fakeGitHub(repo: Record<string, string>, { push = 200 }: { push?: number } = {}) {
  const trees: Tree[] = [];
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const contents = /\/contents\/(.+)$/.exec(url.pathname)?.[1];
    if (url.pathname.endsWith("/git/ref/heads/blog")) {
      return reply({ object: { sha: "head" } });
    }
    if (contents) {
      const path = decodeURIComponent(contents);
      if (path in repo) {
        return reply({ content: bytesToBase64(new TextEncoder().encode(repo[path])), encoding: "base64", sha: `sha:${path}` });
      }
      const listing = Object.keys(repo).filter((file) => file.startsWith(`${path}/`));
      return listing.length
        ? reply(listing.map((file) => ({ name: file.slice(path.length + 1), sha: `sha:${file}`, type: "file" })))
        : reply({ message: "Not Found" }, 404);
    }
    if (url.pathname.endsWith("/git/commits/head")) {
      return reply({ tree: { sha: "base" } });
    }
    if (url.pathname.endsWith("/git/blobs")) {
      return reply({ sha: `blob:${body.content.length}` });
    }
    if (url.pathname.endsWith("/git/trees")) {
      trees.push(body.tree);
      return reply({ sha: "tree" });
    }
    if (url.pathname.endsWith("/git/commits")) {
      return reply({ sha: "commit", html_url: "https://github.com/commit" });
    }
    if (url.pathname.endsWith("/git/refs/heads/blog")) {
      return reply(push === 200 ? {} : { message: "Update is not a fast forward" }, push);
    }
    return reply({ message: `unexpected ${url.pathname}` }, 500);
  });
  return trees;
}

const base = { token: "t", repo: "o/r", branch: "blog", message: "m" };
const markdown = { path: "src/posts/2026-10-11-trip.md", contentBase64: bytesToBase64(new TextEncoder().encode("# hi")) };

afterEach(() => vi.unstubAllGlobals());

describe("commitFiles", () => {
  it("renames, removes and records the redirect in one tree", async () => {
    const trees = fakeGitHub({
      "src/posts/2026-10-11-trip.md": "old",
      "public/assets/img/post/old.webp": "x",
      "src/redirects.txt": "/assets/img/post/older.webp /assets/img/post/old.webp\n",
    });
    await commitFiles({
      ...base,
      files: [markdown, { path: "public/assets/img/post/trip-sea.webp", sha: "sha:public/assets/img/post/old.webp" }],
      expect: { path: markdown.path, sha: `sha:${markdown.path}` },
      fresh: { dir: "public/assets/img/post", names: ["trip-sea.webp"] },
      remove: ["public/assets/img/post/old.webp"],
      redirects: {
        path: "src/redirects.txt",
        moves: [["/assets/img/post/old.webp", "/assets/img/post/trip-sea.webp"]],
        created: ["/assets/img/post/trip-sea.webp"],
      },
    });
    expect(trees).toHaveLength(1);
    expect(trees[0].map((entry) => [entry.path, entry.sha])).toEqual([
      [markdown.path, `blob:${markdown.contentBase64.length}`],
      ["public/assets/img/post/trip-sea.webp", "sha:public/assets/img/post/old.webp"],
      ["src/redirects.txt", expect.stringMatching(/^blob:/)],
      ["public/assets/img/post/old.webp", null],
    ]);
  });

  it("refuses a post that changed since it was opened, and a new post over an existing one", async () => {
    fakeGitHub({ "src/posts/2026-10-11-trip.md": "newer" });
    await expect(commitFiles({ ...base, files: [markdown], expect: { path: markdown.path, sha: "stale" } })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("changed on the site"),
    });
    await expect(commitFiles({ ...base, files: [markdown], expect: { path: markdown.path, sha: "" } })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("already has a post"),
    });
  });

  it("lets a new post through where nothing is, and writes no redirects file with nothing to record", async () => {
    const trees = fakeGitHub({});
    await commitFiles({
      ...base,
      files: [markdown],
      expect: { path: markdown.path, sha: "" },
      redirects: { path: "src/redirects.txt", moves: [], created: [] },
    });
    expect(trees[0].map((entry) => entry.path)).toEqual([markdown.path]);
  });

  it("refuses a photo name the folder already has, whatever its extension or case", async () => {
    fakeGitHub({ "public/assets/img/post/Trip-Sea.webp": "x" });
    await expect(
      commitFiles({ ...base, files: [markdown], fresh: { dir: "public/assets/img/post", names: ["trip-sea.jpg"] } }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("trip-sea.jpg") });
  });

  it("explains a push that lost the race instead of passing on GitHub's 422", async () => {
    fakeGitHub({}, { push: 422 });
    await expect(commitFiles({ ...base, files: [markdown] })).rejects.toMatchObject({
      status: 409,
      message: "Someone published at the same moment. Publish again.",
    });
  });
});
