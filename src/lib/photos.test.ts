import { describe, expect, it } from "vitest";
import { markdownToDoc } from "./import.ts";
import { docToMarkdown } from "./markdown.ts";
import { fullSrc, previewSrc, setSiteUrl } from "./site.ts";

describe("photo text", () => {
  it.each([
    ["quotes in a caption", '![Ảnh](/assets/img/post/a.webp "He said \\"hi\\"")'],
    ["brackets in alt", "![Cười \\[vui\\] (thật)](/assets/img/post/a.webp)"],
    ["Vietnamese, parentheses, curly quotes", '![Đà Lạt (2024)](/assets/img/post/a.webp "“Sương” sớm")'],
    ["a closing backslash", '![a\\\\](/assets/img/post/a.webp "b\\\\")'],
  ])("keeps %s", (_, markdown) => {
    expect(docToMarkdown(markdownToDoc(markdown))).toBe(markdown);
  });

  it("keeps a gallery with escaped captions a gallery", () => {
    const markdown = '```gallery\n![A \\[1\\]](/assets/img/post/a.webp "x \\"y\\"")\n![B](/assets/img/post/b.webp)\n```';
    const doc = markdownToDoc(markdown);
    expect(doc.content?.[0].type).toBe("gallery");
    expect(doc.content?.[0].content?.[0].attrs).toMatchObject({ alt: "A [1]", title: 'x "y"' });
    expect(docToMarkdown(doc)).toBe(markdown);
  });

  it("reads a gallery with blank lines between photos", () => {
    expect(markdownToDoc("```gallery\n![a](/a.webp)\n\n![b](/b.webp)\n```").content?.[0].type).toBe("gallery");
  });

  it("writes plain brackets and quotes escaped", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: "/a.webp", alt: "[x]", title: 'say "hi"' } }] }] };
    expect(docToMarkdown(doc)).toBe('![\\[x\\]](/a.webp "say \\"hi\\"")');
  });
});

const CHARS = [..."ab \\\"'[]()*_~`<>!#{}:.,-Đđẫữ😀“”"];

function randomText(seed: number): string {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: 1 + Math.floor(next() * 12) }, () => CHARS[Math.floor(next() * CHARS.length)]).join("");
}

describe("photo text, any characters", () => {
  it.each(Array.from({ length: 300 }, (_, seed) => [randomText(seed * 2 + 1), randomText(seed * 2 + 2)]))(
    "keeps alt %j and caption %j",
    (alt, title) => {
      const photo = { type: "image", attrs: { src: "/assets/img/post/a.webp", alt, title } };
      for (const doc of [
        { type: "doc", content: [{ type: "paragraph", content: [photo] }] },
        { type: "doc", content: [{ type: "gallery", content: [photo, { type: "image", attrs: { src: "/b.webp", alt: "b" } }] }] },
      ]) {
        const markdown = docToMarkdown(doc);
        expect(docToMarkdown(markdownToDoc(markdown))).toBe(markdown);
        expect(JSON.stringify(markdownToDoc(markdown))).toContain(JSON.stringify({ src: "/assets/img/post/a.webp", alt, title }).slice(1, -1));
      }
    },
  );
});

describe("photo previews", () => {
  it("shows the site's 960 copy and falls back to the original", () => {
    setSiteUrl("https://stevehoang.com");
    expect(previewSrc("/assets/img/post/a.webp")).toBe("https://stevehoang.com/assets/img/resized/960/post/a.webp");
    expect(previewSrc("/assets/img/post/b.jpg")).toBe("https://stevehoang.com/assets/img/resized/960/post/b.webp");
    expect(previewSrc("/assets/img/avatar.png")).toBe("https://stevehoang.com/assets/img/resized/960/avatar.png.webp");
    expect(previewSrc("/assets/img/post/c.gif")).toBe("https://stevehoang.com/assets/img/post/c.gif");
    expect(fullSrc("https://stevehoang.com/assets/img/resized/960/post/a.webp")).toBe("https://stevehoang.com/assets/img/post/a.webp");
    expect(fullSrc("https://stevehoang.com/assets/img/resized/960/avatar.png.webp")).toBe("https://stevehoang.com/assets/img/avatar.png");
    expect(fullSrc("https://stevehoang.com/assets/img/post/a.webp")).toBe("https://stevehoang.com/assets/img/post/a.webp");
    expect(previewSrc("/assets/img/resized/960/post/a.webp")).toBe("https://stevehoang.com/assets/img/resized/960/post/a.webp");
    expect(previewSrc("/assets/img/post/a.webp?v=2")).toBe("https://stevehoang.com/assets/img/post/a.webp?v=2");
    setSiteUrl("");
  });
});
