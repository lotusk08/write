// @vitest-environment happy-dom
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sanitizeHtml } from "@erag/text-editor-vue";
import { describe, expect, it } from "vitest";
import { markdownToDoc, parsePost } from "../lib/import.ts";
import { docToMarkdown } from "../lib/markdown.ts";
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
    ["file path", "Open `src/main.ts`{: .filepath} now"],
    ["raw inline", "*a *b* c* and <span>tag</span>"],
    ["lists", "- one\n- two\n  - nested\n\n3. three\n4. four"],
    ["task lists", "- [ ] todo\n- [x] done\n- plain"],
    ["callouts", "> A tip\n{: .prompt-tip }\n\n> Said\n>\n> Someone\n{: .author }"],
    ["code fences", "```js\nconst a = 1;\n\nconst b = 2;\n```\n\n````\n```\nfence\n```\n````"],
    ["mermaid", "```mermaid\ngraph TD\nA-->B\n```"],
    ["tables", "| a | b |\n|:--|--:|\n| 1 | 2 |\n| 3 | 4 |"],
    ["images and captions", "![alt](/assets/img/post/a.jpg \"Title\")\n*A caption*"],
    ["image rows", "![a](/a.jpg){: .normal .gap }\n![b](/b.jpg){: .normal .gap }\n{: .d-flex .c-center }"],
    ["galleries", "```gallery fan\n![a](/a.jpg \"one\")\n![b](/b.jpg)\n```"],
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
});
