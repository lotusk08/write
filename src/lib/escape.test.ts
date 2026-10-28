import { describe, expect, it } from "vitest";
import type { JSONContent } from "../editor/doc.ts";
import { markdownToDoc, postPathFromLink } from "./import.ts";
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
    [["{: .info}"], "\\{: .info}"],
    [["a | b"], "a \\| b"],
    [["&copy; &amp; &#169; &foo;"], "\\&copy; \\&amp; \\&#169; &foo;"],
    [["Title", "==="], "Title\n\\==="],
    [["Title", "---"], "Title\n\\---"],
    [["a", "2. two"], "a\n2\\. two"],
    [["a", "- b"], "a\n\\- b"],
    [["[^1]: not a note"], "\\[^1]: not a note"],
  ])("%j is written %j and read back as the same text", (lines, written) => {
    const doc = paragraph(...lines);
    expect(docToMarkdown(doc)).toBe(written);
    expect(markdownToDoc(written)).toEqual(doc);
  });

  it("keeps text after code or a link that reads as an attribute list text, escaped", () => {
    for (const mark of [{ type: "code" }, { type: "link", attrs: { href: "/x" } }]) {
      const doc: JSONContent = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "a", marks: [mark] }, { type: "text", text: '{.path} and {icon="x"}' }] }],
      };
      expect(docToMarkdown(doc)).toMatch(/\\\{\.path\} and \\\{icon="x"\}$/);
      expect(markdownToDoc(docToMarkdown(doc))).toEqual(doc);
    }
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

describe("what the text ends with", () => {
  it("keeps a heading's closing #, and a backslash before a mark or a line end", () => {
    const heading = (text: string) => ({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] }] });
    expect(docToMarkdown(heading("Learning C#"))).toBe("## Learning C#");
    expect(docToMarkdown(heading("Issue #"))).toBe("## Issue \\#");
    for (const text of ["Learning C#", "Issue #", "Title ##"]) {
      expect(markdownToDoc(docToMarkdown(heading(text)))).toEqual(heading(text));
    }
    expect(markdownToDoc("## Title ##")).toEqual(heading("Title"));
    const slash = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "C:\\" },
            { type: "text", text: "Users", marks: [{ type: "bold" }] },
            { type: "text", text: " D:\\" },
            { type: "hardBreak" },
            { type: "text", text: "end \\" },
          ],
        },
      ],
    };
    expect(docToMarkdown(slash)).toBe("C:\\\\**Users** D:\\\\\nend \\");
    expect(markdownToDoc(docToMarkdown(slash))).toEqual(slash);
  });
});

describe("what CommonMark reads, as the blog renders it", () => {
  const types = (markdown: string) => markdownToDoc(markdown).content?.map((node) => node.type);
  const link = (markdown: string) => JSON.stringify(markdownToDoc(markdown).content?.[0]);

  it("follows reference links to their definitions, kept as written", () => {
    const post = "[t][R], [r][] and [r]\n\n![p][i]\n\n[r]: https://x.com \"T\"\n[i]: /a.jpg";
    expect(link(post).match(/"href":"https:\/\/x.com","title":"T"/g)).toHaveLength(3);
    expect(markdownToDoc(post).content?.[1]).toMatchObject({ type: "image", attrs: { src: "/a.jpg", alt: "p" } });
    expect(docToMarkdown(markdownToDoc(post))).toBe(
      '[t](https://x.com "T"), [r](https://x.com "T") and [r](https://x.com "T")\n\n![p](/a.jpg)\n\n[r]: https://x.com "T"\n[i]: /a.jpg',
    );
    expect(link("[x][r]\n\n[r]: javascript:alert(1)")).not.toContain('"link"');
  });

  it("lets only a list counting from 1 break into a paragraph", () => {
    expect(types("in\n2019. It was")).toEqual(["paragraph"]);
    expect(docToMarkdown(markdownToDoc("in\n2019. It was"))).toBe("in\n2019\\. It was");
    expect(types("in\n1. It was")).toEqual(["paragraph", "orderedList"]);
  });

  it("ends a quote at a rule or block HTML, not a heading, as the blog's quotes do", () => {
    expect(types("> q\n---")).toEqual(["blockquote", "horizontalRule"]);
    expect(markdownToDoc("> q\n## H").content?.[0].content?.map((node) => node.type)).toEqual(["paragraph", "heading"]);
  });

  it("reads an empty item as an item, not the underline of a heading", () => {
    expect(docToMarkdown(markdownToDoc("- Milk\n-\n- Eggs"))).not.toContain("#");
  });

  it("reads a table without outer pipes, and code indented four spaces", () => {
    expect(markdownToDoc("a | b\n--|--\n1 | 2").content?.[0].content?.[0].content?.[0].type).toBe("tableHeader");
    expect(docToMarkdown(markdownToDoc("para\n\n    code\n      more"))).toBe("para\n\n```\ncode\n  more\n```");
    expect(types("para\n    still para")).toEqual(["paragraph"]);
  });

  it("keeps a spacer paragraph of a no-break space", () => {
    expect(docToMarkdown(markdownToDoc("a\n\n&nbsp;\n\nb"))).toBe("a\n\n&nbsp;\n\nb");
  });

  it("reads brackets or quotes nested thousands deep as text, without overflowing", () => {
    expect(() => markdownToDoc("[".repeat(3000))).not.toThrow();
    expect(() => markdownToDoc(`${">".repeat(3000)} a`)).not.toThrow();
  });
});

describe("rules", () => {
  it("are read with spaces between their marks, not as a list of lists", () => {
    for (const rule of ["* * *", "- - -", "_ _ _", "***"]) {
      expect(markdownToDoc(`a\n\n${rule}\n\nb`).content?.map((node) => node.type)).toEqual(["paragraph", "horizontalRule", "paragraph"]);
    }
  });
});

describe("links to a post", () => {
  it("read a stray percent sign as written", () => {
    expect(postPathFromLink("src/posts/100%-sure.md")).toBe("src/posts/100%-sure.md");
    expect(postPathFromLink("src/posts/a%20b.md")).toBe("src/posts/a b.md");
  });
});

describe("players", () => {
  it("read an address with an ampersand back as written", () => {
    const written = '<EmbedAudio src="https://a.com/x.mp3?v=1&amp;t=2" />';
    expect(markdownToDoc(written).content?.[0].attrs?.id).toBe("https://a.com/x.mp3?v=1&t=2");
    expect(docToMarkdown(markdownToDoc(written))).toBe(written);
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

  it("end at their own closing tag, not one written in code, and keep text before it on its line", () => {
    for (const written of [
      "<details>\n<summary>S</summary>\n\nUse the `<details>` element.\n\n</details>\n\n## After",
      "<details>\n<summary>S</summary>\n\n```html\n<details>\n</details>\n```\n\n</details>\n\n## After",
      "<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\nIn\n\n</details>\n\n</details>\n\n## After",
    ]) {
      expect(docToMarkdown(markdownToDoc(written))).toBe(written);
    }
    expect(docToMarkdown(markdownToDoc("<details>\n<summary>S</summary>\n\nText.</details>"))).toBe(
      "<details>\n<summary>S</summary>\n\nText.\n\n</details>",
    );
  });

  it("reads a line of many internationalised labels at once", () => {
    expect(docToMarkdown(markdownToDoc(`see http://${"xn--a.".repeat(40)}xn--a_`))).toContain("xn--a\\_");
  });
});
