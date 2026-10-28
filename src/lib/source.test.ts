import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { newPostMeta } from "./draft.ts";
import { loadReader } from "./reader.ts";
import { readSource, rememberSource, sourceFor, withFront } from "./source.ts";

const BLOG = resolve(process.env.BLOG_DIR ?? join(import.meta.dirname, "../../../stevehoang.com"));
const POSTS = join(BLOG, "src/posts");

const post = '---\ntitle: "Trip"\ndescription: "A day: out"\ndate: 2026-10-11 09:00 +0700\ntags: [sea, trip]\n---\nSome _text_ here.\n\n{: .info }\n';

describe("the source view", () => {
  beforeAll(() => loadReader());
  it("shows a post as it was typed while it reads the same", () => {
    const { meta, doc } = readSource(post, newPostMeta());
    const kept = rememberSource(post, meta, doc);
    expect(sourceFor({ ...newPostMeta(), ...meta }, doc, kept)).toBe(post);
  });

  it("writes afresh only the half that changed", () => {
    const { meta, doc } = readSource(post, newPostMeta());
    const kept = rememberSource(post, meta, doc);
    const retitled = sourceFor({ ...meta, title: "Sea" }, doc, kept);
    expect(retitled).toMatch(/^---\ntitle: Sea\n/);
    expect(retitled.endsWith("---\nSome _text_ here.\n\n{: .info }\n")).toBe(true);
    const edited = sourceFor(meta, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "New" }] }] }, kept);
    expect(edited).toBe('---\ntitle: "Trip"\ndescription: "A day: out"\ndate: 2026-10-11 09:00 +0700\ntags: [sea, trip]\n---\nNew\n');
    expect(withFront(post, { ...meta, toc: false })).toContain("toc: false\n---\nSome _text_");
  });

  it("reads the fields from the front matter, clearing one taken out, and keeps them with none", () => {
    const was = { ...newPostMeta("Old"), description: "Old one", moments: false };
    expect(readSource("---\ntitle: New\n---\nBody\n", was).meta).toMatchObject({ title: "New", description: "", date: was.date, moments: undefined });
    expect(readSource("Body only\n", was).meta).toBe(was);
  });

  it.skipIf(!existsSync(POSTS))("gives every post on the blog back as written", () => {
    for (const name of readdirSync(POSTS).filter((file) => file.endsWith(".md"))) {
      const text = readFileSync(join(POSTS, name), "utf8");
      const { meta, doc } = readSource(text, newPostMeta());
      expect(sourceFor({ ...newPostMeta(), ...meta }, doc, rememberSource(text, meta, doc)), name).toBe(text);
    }
  });
});
