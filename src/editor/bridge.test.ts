// @vitest-environment happy-dom
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sanitizeHtml } from "@erag/text-editor-vue";
import { describe, expect, it } from "vitest";
import { newPostMeta } from "../lib/draft.ts";
import { markdownToDoc, parsePost } from "../lib/import.ts";
import { buildPostFile, docToMarkdown } from "../lib/markdown.ts";
import { docToHtml, htmlToDoc } from "./bridge.ts";
import { sanitizerOptions } from "./config.ts";
import type { JSONContent } from "./doc.ts";

/** What the editor hands back for a draft: rendered, sanitized as the editor does, and read again. */
function throughEditor(doc: JSONContent): JSONContent {
  const html = docToHtml(doc, { display: (src) => src });
  return htmlToDoc(sanitizeHtml(html, sanitizerOptions));
}

function roundTrip(markdown: string): string {
  return docToMarkdown(throughEditor(markdownToDoc(markdown)));
}

describe("bridge", () => {
  it.each([
    ["paragraphs and breaks", "One line\nand the next\n\nA second paragraph"],
    ["a break ending a block", "Poem line\n\n> quoted\n> lines"],
    ["headings", "## Two\n\n### Three\n\n#### Four"],
    ["marks", "**bold** *italic* ~~gone~~ <u>under</u> <mark>lit</mark> m<sup>2</sup> H<sub>2</sub>O `code`"],
    ["nested marks and links", "*[Title](https://example.com)* and [*Title*](https://example.com \"t\")"],
    ["bold inside italic", "*__both__* and ***swap***"],
    ["file path", "Open `src/main.ts`{.path} now"],
    ["raw inline", "*a *b* c* and <span>tag</span>"],
    ["lists", "- one\n- two\n  - nested\n\n3. three\n4. four"],
    ["task lists", "- [ ] todo\n- [x] done\n- plain"],
    ["callouts", "> [!tip]\n> A tip\n\n> [!author]\n> Said\n>\n> Someone"],
    ["code fences", "```js\nconst a = 1;\n\nconst b = 2;\n```\n\n````\n```\nfence\n```\n````"],
    ["diagrams", "```diagram\ngraph TD\nA-->B\n```"],
    ["tables", "| a | b |\n|:--|--:|\n| 1 | 2 |\n| 3 | 4 |"],
    ["images and captions", "![alt](/assets/img/post/a.jpg \"Title\")\n*A caption*"],
    ["galleries", "```gallery\n![a](/a.jpg \"one\")\n![b](/b.jpg)\n```"],
    ["embeds", "<EmbedYoutube id=\"dQw4w9WgXcQ\" />\n\n<EmbedVideo src=\"/v.mp4\" />"],
    ["footnotes", "A claim[^1].\n\n[^1]: The source."],
    ["rules and attribute lists", "Above\n\n---\n{: .divider }\n\n{: .lead }\nBelow"],
    ["raw html blocks", "<div class=\"box\">\n  kept as written\n</div>"],
    ["details", "<details markdown=\"1\">\n<summary>More</summary>\n\nHidden\n</details>"],
    ["bare links", "See https://x.com/_b_c and <https://example.com/a_b>"],
    ["escapes", "1\\. not a list and \\*stars\\* and a\\_b"],
  ])("keeps %s", (_name, markdown) => {
    const expected = docToMarkdown(markdownToDoc(markdown));
    expect(roundTrip(markdown)).toBe(expected);
  });

  it("keeps a Spotify player, which the blog no longer draws, as the raw line it was", () => {
    const markdown = 'Song\n\n<EmbedSpotify id="4uLU6hMCjMI75M1A2tKUQC" />\n\nAfter';
    expect(markdownToDoc(markdown).content?.[1].type).toBe("rawBlock");
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("writes every gallery as a plain gallery fence", () => {
    const photos = '![a](/a.jpg "one")\n![b](/b.jpg)';
    expect(roundTrip(`\`\`\`gallery deck\n${photos}\n\`\`\``)).toBe(`\`\`\`gallery\n${photos}\n\`\`\``);
    expect(roundTrip("```gallery\nnot a photo\n```")).toBe("```gallery\nnot a photo\n```");
  });

  it("keeps a collapsible section and its state", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "collapsible",
          attrs: { open: false },
          content: [
            { type: "collapsibleSummary", content: [{ type: "text", text: "Section" }] },
            {
              type: "collapsibleContent",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Inside" }] }],
            },
          ],
        },
      ],
    };
    expect(throughEditor(doc)).toEqual(doc);
  });

  it("keeps a local photo's address out of the src", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "image", attrs: { src: "local:abc", alt: "A photo", title: null } }],
    };
    const html = docToHtml(doc);
    expect(html).toContain('data-local-src="local:abc"');
    expect(html).not.toMatch(/\ssrc="local:/);
    expect(throughEditor(doc)).toEqual(doc);
  });

  it("lifts a photo typed into a paragraph out into a block of its own", () => {
    const doc = htmlToDoc('<p>before<img src="/a.jpg" alt="a">after</p>');
    expect(doc.content?.map((node) => node.type)).toEqual(["paragraph", "image", "paragraph"]);
  });

  it("reads what the browser types: <b>, <i>, <div> lines and placeholder breaks", () => {
    const doc = htmlToDoc("<div>one <b>two</b> <i>three</i></div><div><br></div><p>four<br></p>");
    expect(docToMarkdown(doc)).toBe("one **two** *three*\n\nfour");
  });

  it.each([
    ["tip", "tip"],
    ["info", "info"],
    ["key", "important"],
    ["warn", "warning"],
    ["risk", "danger"],
    ["author", "author"],
    ["poem", "poem"],
  ])("reads > [!%s] as the %s callout and writes it back, and the older {: .%s } as it", (name, note) => {
    const markdown = `> [!${name}]\n> said`;
    expect(markdownToDoc(markdown).content?.[0].attrs?.note).toBe(note);
    expect(roundTrip(markdown)).toBe(markdown);
    expect(markdownToDoc(`> said\n{: .${name}}`).content?.[0].attrs?.note).toBe(note);
    expect(roundTrip(`> said\n{: .${name} }`)).toBe(markdown);
  });

  it("reads GitHub's own names for its alerts, in any case, as the blog's callouts", () => {
    for (const [name, note] of [["NOTE", "info"], ["Important", "important"], ["warning", "warning"], ["CAUTION", "danger"], ["Tip", "tip"]]) {
      expect(markdownToDoc(`> [!${name}]\n> said`).content?.[0].attrs?.note).toBe(note);
    }
    expect(markdownToDoc("> [!other]\n> said").content?.[0].attrs?.note).toBeNull();
    expect(roundTrip("> [!NOTE]\n> said")).toBe("> [!info]\n> said");
  });

  it.each([
    ["a callout holding a list and a file path", "> [!info]\n> A list:\n> - one with `a/b`{.path}\n> - two"],
    ["a callout holding a plain quote", "> [!warn]\n> Outer\n>\n> > Inner"],
    ["a callout holding code", "> [!tip]\n> Code:\n>\n> ```js\n> const a = 1;\n> ```"],
    ["a callout holding a photo", '> [!key]\n> A photo:\n>\n> ![Cua](/assets/img/post/cua.webp "Cua")'],
    ["a callout inside a list item", "- An item\n  > [!info]\n  > Inside\n- Next"],
    ["a file path in a heading, a link, a table and a footnote", "## Head `src/a.js`{.path}\n\n[`l/p`{.path}](https://example.com) and a note[^1].\n\n| file | n |\n| --- | --- |\n| `t/x`{.path} | 1 |\n\n[^1]: Has `f/p`{.path}."],
    ["a code block without line numbers in a list", "- Code:\n\n  ```text\n  plain\n  ```\n  {.nolines}"],
    ["the social row", '[LinkedIn](https://x.com){icon="linkedin"}\n[GitHub](https://y.com){icon="square-github"}\n{.social}'],
    ["the older attribute lists", '[In](https://x.com){: icon="linkedin"}\n{: .social}\n\n```text\nplain\n```\n{: .nolines}'],
  ])("keeps %s as written", (_name, markdown) => {
    expect(docToMarkdown(markdownToDoc(markdown))).toBe(markdown);
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it.each([
    ["a list under its lead-in, inside a quote", "> [!info]\n> A list:\n> - one\n> - two"],
    ["a quote under an item's text", "- An item\n  > [!info]\n  > Inside\n- Next"],
    ["code under a paragraph", "Run:\n```sh\nls\n```"],
    ["a heading under a paragraph", "Text\n## Head"],
    ["a table under a paragraph", "Para\n| a | b |\n| --- | --- |\n| 1 | 2 |"],
    ["a quote under a list", "- a\n> quote"],
  ])("writes %s back without a blank line", (_name, markdown) => {
    expect(docToMarkdown(markdownToDoc(markdown))).toBe(markdown);
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("writes a break in a heading from H3 down as <br>, and reads it back as a break", () => {
    expect(docToMarkdown(htmlToDoc("<h3>one<br>two</h3>"))).toBe("### one<br>two");
    expect(markdownToDoc("#### a<br>b").content?.[0].content?.map((node) => node.type)).toEqual(["text", "hardBreak", "text"]);
    expect(roundTrip("### one<br>two")).toBe("### one<br>two");
    expect(roundTrip("## a<br>b")).toBe("## a<br>b");
    expect(roundTrip("### a<br />b")).toBe("### a<br />b");
  });

  it("never joins a rule to the paragraph above, which would make it a heading", () => {
    expect(roundTrip("Text\n***")).toBe("Text\n\n---");
  });

  it("keeps a numbered list that does not count from 1 off the paragraph above it", () => {
    expect(roundTrip("## Steps\n3. three\n4. four")).toBe("## Steps\n3. three\n4. four");
    expect(roundTrip("- Item\n\n  3. three\n  4. four")).toBe("- Item\n\n  3. three\n  4. four");
    const moved = markdownToDoc("## Steps\n3. three");
    moved.content?.splice(0, 1, { type: "paragraph", content: [{ type: "text", text: "Lead" }] });
    expect(docToMarkdown(moved)).toBe("Lead\n\n3. three");
  });

  it("opens a quote saved with {: .poem} as its attribute list as the poem callout, written once", () => {
    const saved: JSONContent = {
      type: "doc",
      content: [{ type: "blockquote", attrs: { note: null, blockIal: "{: .poem }" }, content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }],
    };
    const doc = throughEditor(saved);
    expect(doc.content?.[0].attrs?.note).toBe("poem");
    expect(docToMarkdown(doc)).toBe("> [!poem]\n> a");
  });

  it("keeps a poem's lines and stanzas", () => {
    const markdown = "> [!poem]\n> Line one\n> line two\n>\n> Last line\n> of all";
    const quote = markdownToDoc(markdown).content?.[0];
    expect(quote?.attrs?.note).toBe("poem");
    expect(quote?.content?.map((node) => node.type)).toEqual(["paragraph", "paragraph"]);
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("keeps an old {: .note-info } as it was written, not as a callout", () => {
    const markdown = "> said\n{: .note-info }";
    expect(markdownToDoc(markdown).content?.[0].attrs?.note).toBeNull();
    expect(roundTrip(markdown)).toBe(markdown);
  });
});

const BLOG = resolve(process.env.BLOG_DIR ?? join(import.meta.dirname, "../../../stevehoang.com"));
const CORPUS = ["src/posts", "src/drafts", "src/pages"]
  .map((dir) => join(BLOG, dir))
  .filter(existsSync)
  .flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => join(dir, name)),
  );

describe.skipIf(CORPUS.length === 0)("the blog's posts", () => {
  it.each(CORPUS.map((path) => [path.slice(BLOG.length + 1), path]))(
    "%s passes through the editor unchanged",
    (_name, path) => {
      const { doc } = parsePost(readFileSync(path, "utf8"));
      expect(docToMarkdown(throughEditor(doc))).toBe(docToMarkdown(doc));
    },
  );

  const DROPPED = new Set(["author", "categories", "math", "mermaid", "chart", "render_with_liquid"]);
  const keys = (file: string) => [.../^---\r?\n([\s\S]*?)\r?\n---/.exec(file)?.[1].matchAll(/^([A-Za-z_][\w-]*):/gm) ?? []].map((key) => key[1]);

  it.each(CORPUS.map((path) => [path.slice(BLOG.length + 1), path]))(
    "%s keeps its front matter, every field the app has no box for as written",
    (_name, path) => {
      const source = readFileSync(path, "utf8");
      const { meta, doc } = parsePost(source);
      const full = { ...newPostMeta(), ...meta };
      const file = buildPostFile(full, doc);
      expect({ ...newPostMeta(), date: full.date, ...parsePost(file).meta }).toEqual(full);
      const kept = keys(source).filter((key) => !DROPPED.has(key) && (key !== "description" || meta.description?.trim()));
      expect(keys(file)).toEqual(expect.arrayContaining(kept));
      expect(file.split("\n")).toEqual(expect.arrayContaining(meta.extra ?? []));
    },
  );
});
