import { describe, expect, it } from "vitest";
import { newPostMeta } from "./draft.ts";
import { parsePost } from "./import.ts";
import { buildPostFile } from "./markdown.ts";

const written = (source: string) => {
  const { meta, doc } = parsePost(source);
  return buildPostFile({ ...newPostMeta(), ...meta }, doc);
};

describe("front matter the app has no field for", () => {
  it("keeps every field the blog reads, line for line, after the ones the app writes", () => {
    const post = [
      "---",
      "title: Trip",
      "description: A day out",
      "date: 2026-10-11 09:00 +0700",
      "lang: vi",
      "tags:",
      "  - travel",
      "pin: 3",
      "toc: false",
      "comments: false",
      "hidden: true",
      "redirect_from:",
      "  - /old-trip",
      "  - /trip-2026",
      "last_modified_at: 2026-10-12 10:00 +0700",
      "updated: 2026-10-13",
      "---",
      "Text",
      "",
    ].join("\n");
    expect(parsePost(post).meta.extra).toEqual([
      "comments: false",
      "hidden: true",
      "redirect_from:",
      "  - /old-trip",
      "  - /trip-2026",
      "last_modified_at: 2026-10-12 10:00 +0700",
      "updated: 2026-10-13",
    ]);
    expect(written(post)).toBe(post);
  });

  it("moves one written between the app's fields to the end, its value as written", () => {
    const post = "---\ntitle: X\nredirect_from: [/old-address]\ndate: 2026-10-11 09:00 +0700\nhidden: true # for now\npin: 2\ntoc: true\n---\nText\n";
    expect(written(post)).toBe("---\ntitle: X\ndate: 2026-10-11 09:00 +0700\ntags: []\npin: 2\ntoc: true\nredirect_from: [/old-address]\nhidden: true # for now\n---\nText\n");
  });

  it("reads moments as a switch and writes it last, as the blog's posts carry it", () => {
    const post = "---\ntitle: X\ndate: 2026-10-11 09:00 +0700\ntags: []\npin: false\ntoc: true\nimage:\n  path: /a.webp\nredirect_from: /old\nmoments: false\n---\nText\n";
    expect(parsePost(post).meta.moments).toBe(false);
    expect(parsePost(post).meta.extra).toEqual(["redirect_from: /old"]);
    expect(written(post)).toBe(post);
    expect(written(post.replace("moments: false", "moments: True"))).toContain("\nmoments: true\n---");
    expect(written(post.replace("\nmoments: false", ""))).not.toContain("moments");
    expect(parsePost(post.replace("moments: false", "moments: maybe")).meta.extra).toEqual(["redirect_from: /old", "moments: maybe"]);
    const odd = parsePost(post.replace("moments: false", 'moments: "false"'));
    const file = buildPostFile({ ...newPostMeta(), ...odd.meta, moments: false }, odd.doc);
    expect(file.match(/^moments:/gm)).toHaveLength(1);
    expect(file).toContain("redirect_from: /old\nmoments: false\n---");
  });

  it("keeps a key of any shape, and a comment, with the fields kept as written", () => {
    const post = '---\ntitle: X\n# a note\ndate: 2026-10-11 09:00 +0700\nog:image: /a.jpg\nseo.title: Y\n"quoted key": v\n2fa: yes\n---\nText\n';
    expect(written(post)).toBe(
      '---\ntitle: X\ndate: 2026-10-11 09:00 +0700\ntags: []\npin: false\ntoc: true\n# a note\nog:image: /a.jpg\nseo.title: Y\n"quoted key": v\n2fa: yes\n---\nText\n',
    );
  });

  it("drops what the blog no longer reads", () => {
    const post = "---\ntitle: X\nauthor: steve\ncategories: [Vietnamese]\nmath: true\nrender_with_liquid: false\ndate: 2026-10-11 09:00 +0700\n---\nText\n";
    expect(written(post)).toBe("---\ntitle: X\ndate: 2026-10-11 09:00 +0700\nlang: vi\ntags: []\npin: false\ntoc: true\n---\nText\n");
  });
});

describe("what a node carries that the page does not show", () => {
  it("never lets an address, title, attribute list, language or label end its line", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockIal: "{: .x}\n\n<script>1</script>" },
          content: [
            { type: "text", text: "this", marks: [{ type: "link", attrs: { href: "https://a.com/\n\n<script>2</script>", title: "t\n\n<b>" } }] },
            { type: "footnoteRef", attrs: { label: "1]\n\n<script>3</script>" } },
          ],
        },
        { type: "image", attrs: { src: "/a.jpg\n\n<script>4</script>", alt: "", ial: "{: .y}\n<script>5</script>" } },
        { type: "codeBlock", attrs: { language: "js\n<script>6</script>\n```" }, content: [{ type: "text", text: "x" }] },
      ],
    };
    const markdown = buildPostFile({ ...newPostMeta(), title: "T" }, doc);
    expect(markdown).not.toMatch(/^<script>/m);
    expect(markdown).toContain("[this](https://a.com/%0A%0A<script>2</script> \"t <b>\")");
    expect(markdown).toContain("![](/a.jpg%0A%0A<script>4</script>)");
    expect(markdown).toContain("```js<script>6</script>\nx\n```");
  });

  it("reads no script link, a spaced one included", () => {
    expect(JSON.stringify(parsePost("[x](javascript:location=name )").doc)).not.toContain('"link"');
  });
});
