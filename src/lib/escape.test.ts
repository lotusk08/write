import { describe, expect, it } from "vitest";
import type { JSONContent } from "../editor/doc.ts";
import { markdownToDoc } from "./import.ts";
import { docToMarkdown } from "./markdown.ts";

function paragraph(...lines: string[]): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: lines.flatMap((text, index) => [...(index ? [{ type: "hardBreak" }] : []), { type: "text", text }]),
      },
    ],
  };
}

describe("text that looks like Markdown", () => {
  it.each([
    [["# not a heading"], "\\# not a heading"],
    [["##### Title"], "\\##### Title"],
    [["1. not a list"], "1\\. not a list"],
    [["2020. a year"], "2020\\. a year"],
    [["- x"], "\\- x"],
    [["+ x"], "\\+ x"],
    [["---"], "\\---"],
    [["> q"], "\\> q"],
    [["{: .note-info}"], "\\{: .note-info}"],
    [["a | b"], "a \\| b"],
    [["&copy; &amp; &#169; &foo;"], "\\&copy; \\&amp; \\&#169; &foo;"],
    [["Title", "==="], "Title\n\\==="],
    [["Title", "---"], "Title\n\\---"],
    [["a", "2. two"], "a\n2\\. two"],
    [["a", "- b"], "a\n\\- b"],
  ])("%j is written %j and read back as the same text", (lines, written) => {
    const doc = paragraph(...lines);
    expect(docToMarkdown(doc)).toBe(written);
    expect(markdownToDoc(written)).toEqual(doc);
  });

  it("decodes an entity the site would draw as its character", () => {
    expect(markdownToDoc("&copy; &#x1F600; &unknownname;")).toEqual(paragraph("© 😀 &unknownname;"));
  });

  it("writes a link address with an unbalanced parenthesis in angle brackets", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "https://x.com/a)b" } }] }] }],
    };
    expect(docToMarkdown(doc)).toBe("[x](<https://x.com/a)b>)");
    expect(markdownToDoc("[x](<https://x.com/a)b>)")).toEqual(doc);
  });

  it("reads the site's headerless table, every line a row of pipes, and writes it back", () => {
    const source = "| Morning | Coffee |\n| Noon | Rice |";
    expect(markdownToDoc(source).content?.[0].type).toBe("table");
    expect(docToMarkdown(markdownToDoc(source))).toBe(source);
  });

  it("keeps a pipe in a table cell's text and code escaped once", () => {
    const source = "| a | b |\n| --- | --- |\n| c \\| d | `e\\|f` |";
    expect(docToMarkdown(markdownToDoc(source))).toBe(source);
  });
});

describe("photos", () => {
  it("fold a line break in alt or caption, which would end the line a gallery photo needs", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "gallery", content: [{ type: "image", attrs: { src: "/a.webp", alt: "one\ntwo", title: "x \n y" } }] }],
    };
    expect(docToMarkdown(doc)).toBe('```gallery\n![one two](/a.webp "x y")\n```');
  });
});

describe("sections", () => {
  it("read back as a section, its summary plain text as the site shows it", () => {
    const written = "<details>\n<summary>a_b *em* &lt;x&gt; &amp;</summary>\n\nbody\n\n</details>";
    const doc = markdownToDoc(written);
    expect(doc.content?.[0].type).toBe("collapsible");
    expect(doc.content?.[0].content?.[0].content).toEqual([{ type: "text", text: "a_b *em* <x> &" }]);
    expect(docToMarkdown(doc)).toBe(written);
  });
});
