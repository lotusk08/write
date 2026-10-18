import { describe, expect, it } from "vitest";
import { markdownToDoc, parsePost } from "./import.ts";

describe("a post's front matter", () => {
  it("is read past a byte-order mark, CRLF line ends and spaces after the closing line", () => {
    for (const source of [
      "---\ntitle: A\n---\nBody\n",
      "\ufeff---\ntitle: A\n---\nBody\n",
      "---\r\ntitle: A\r\n---\r\nBody\r\n",
      "---\ntitle: A\n---  \nBody\n",
    ]) {
      const { meta, doc } = parsePost(source);
      expect(meta.title, JSON.stringify(source)).toBe("A");
      expect(doc).toEqual(markdownToDoc("Body\n"));
    }
    expect(parsePost("---\ntitle: A\n---").meta.title).toBe("A");
    expect(parsePost("---\n\n---\nBody").meta).toEqual({ lang: "", toc: true });
  });

  it("is none when the opening line carries more than ---, nothing stands between the two, or it never closes", () => {
    for (const source of [
      "--- \ntitle: A\n---\nBody\n",
      "---\n---\nBody\n",
      "---\ntitle: A\nBody\n",
      "---\ntitle: A\n----\nBody\n",
      "\ufeff\ufeff---\ntitle: A\n---\nBody\n",
    ]) {
      const { meta, doc } = parsePost(source);
      expect(meta, JSON.stringify(source)).toEqual({});
      expect(doc).toEqual(markdownToDoc(source.replace(/^\ufeff/, "")));
    }
  });

  it("ends at the first closing line", () => {
    const { meta, doc } = parsePost("---\ntitle: A\n---\nBody\n---\nMore\n");
    expect(meta.title).toBe("A");
    expect(doc).toEqual(markdownToDoc("Body\n---\nMore\n"));
  });
});
