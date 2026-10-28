// @vitest-environment happy-dom
import { sanitizeHtml } from "@erag/text-editor-vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markdownToDoc } from "../lib/import.ts";
import { docToMarkdown } from "../lib/markdown.ts";
import { fullSrc, previewSrc, setSiteUrl } from "../lib/site.ts";
import { docToHtml, htmlToDoc } from "./bridge.ts";
import { clipboardOf, copiedBlocks } from "./clipboard.ts";
import {
  insertDoc,
  insertImages,
  leaveGallery,
  moveBlock,
  moveGalleryPhoto,
  removeGalleryPhoto,
  selectFigure,
  setImageAlt,
  setImageCaption,
} from "./commands.ts";
import { sanitizerOptions } from "./config.ts";

vi.mock("../lib/db.ts", async (original) => ({
  ...(await original<typeof import("../lib/db.ts")>()),
  storeImageFile: async () => ({ id: crypto.randomUUID() }),
}));

const CAPTIONS = ['Hồ Gươm "buổi sáng"', "Cười [vui] (thật)", "Đà Lạt — sương mù", "plain"];

const photo = (index: number) => `![${CAPTIONS[index % CAPTIONS.length].replace(/[[\]]/g, "\\$&")} ${index}](/assets/img/post/p-${index}.webp)`;

let root: HTMLElement;

function load(markdown: string): void {
  root.innerHTML = docToHtml(markdownToDoc(markdown), { display: (src) => src });
}

/** The markdown the editor's content stands for now, after the editor's own sanitizing. */
function markdown(): string {
  return docToMarkdown(htmlToDoc(sanitizeHtml(root.innerHTML, sanitizerOptions)));
}

/** Saving and opening again changes nothing. */
function stable(): string {
  const text = markdown();
  expect(docToMarkdown(markdownToDoc(text))).toBe(text);
  return text;
}

const photos = () => [...root.querySelectorAll<HTMLElement>("[data-gallery] figure[data-image]")];
const names = () => photos().map((figure) => figure.querySelector("img")?.getAttribute("data-src") ?? "local");

beforeEach(() => {
  document.body.innerHTML = '<div contenteditable="true"></div>';
  root = document.body.firstElementChild as HTMLElement;
  load(`\`\`\`gallery\n${Array.from({ length: 100 }, (_, index) => photo(index)).join("\n")}\n\`\`\``);
});

describe("a gallery of a hundred photos", () => {
  it("reads back every photo and caption exactly", () => {
    expect(photos()).toHaveLength(100);
    expect(stable()).toContain('![Hồ Gươm "buổi sáng" 0]');
    expect(stable()).toContain("![Cười \\[vui\\] (thật) 1]");
  });

  it("takes fifty new photos right after the selected one, in order", async () => {
    selectFigure(root, photos()[49]);
    const files = Array.from({ length: 50 }, (_, index) => new File([String(index)], `${index}.jpg`, { type: "image/jpeg" }));
    await insertImages(root, files, () => true);
    const after = names();
    expect(after).toHaveLength(150);
    expect(after.slice(0, 50)).toEqual(Array.from({ length: 50 }, (_, index) => `/assets/img/post/p-${index}.webp`));
    expect(after.slice(50, 100).every((name) => name === "local")).toBe(true);
    expect(after[100]).toBe("/assets/img/post/p-50.webp");
    expect(root.querySelector(".is-selected")).toBe(photos()[99]);
    expect(root.querySelectorAll("[data-gallery]")).toHaveLength(1);
    expect(stable().match(/local:/g)).toHaveLength(50);
  });

  it("moves the first photo to the end, one step at a time", () => {
    selectFigure(root, photos()[0]);
    for (let step = 0; step < 99; step += 1) {
      expect(moveGalleryPhoto(root, 1)).toBe(true);
    }
    expect(moveGalleryPhoto(root, 1)).toBe(false);
    expect(names()[99]).toBe("/assets/img/post/p-0.webp");
    expect(names()[0]).toBe("/assets/img/post/p-1.webp");
    stable();
  });

  it("removes every photo one by one, ending as one plain photo and then nothing", () => {
    selectFigure(root, photos()[0]);
    for (let left = 100; left > 2; left -= 1) {
      expect(removeGalleryPhoto(root)).toBe(true);
      expect(photos()).toHaveLength(left - 1);
    }
    expect(removeGalleryPhoto(root)).toBe(true);
    expect(root.querySelector("[data-gallery]")).toBeNull();
    expect(root.querySelectorAll("figure[data-image]")).toHaveLength(1);
    expect(stable()).toBe("![plain 99](/assets/img/post/p-99.webp)");
    expect(removeGalleryPhoto(root)).toBe(false);
  });

  it("writes a caption as the title, in quotes, and keeps the alt text apart", () => {
    load('```gallery\n![old](/assets/img/post/a.webp "A title")\n![b](/assets/img/post/b.webp)\n```');
    setImageCaption(root, photos()[0], ' Sài Gòn "đêm" [1] ');
    setImageCaption(root, photos()[1], "Two small birds");
    expect(stable()).toBe(
      '```gallery\n![old](/assets/img/post/a.webp "Sài Gòn \\"đêm\\" [1]")\n![b](/assets/img/post/b.webp "Two small birds")\n```',
    );
    setImageAlt(root, photos()[0], " Một con đường [1] ");
    setImageCaption(root, photos()[1], "  ");
    expect(stable()).toBe(
      '```gallery\n![Một con đường \\[1\\]](/assets/img/post/a.webp "Sài Gòn \\"đêm\\" [1]")\n![b](/assets/img/post/b.webp)\n```',
    );
  });

  it("leaves the gallery for the paragraph after it when typing starts", () => {
    selectFigure(root, photos()[10]);
    expect(leaveGallery(root)).toBe(true);
    expect(root.querySelector(".is-selected, [tabindex]")).toBeNull();
    expect(window.getSelection()?.anchorNode?.parentElement?.closest("p") ?? window.getSelection()?.anchorNode).toBe(
      root.querySelector("[data-gallery]")?.nextElementSibling,
    );
    expect(leaveGallery(root)).toBe(false);
  });
});

describe("a site photo's preview", () => {
  it("falls back from the 960px copy to the original, then stops", () => {
    setSiteUrl("https://stevehoang.com");
    for (const src of ["/assets/img/post/a.jpg", "/assets/img/post/b.webp", "/assets/img/avatar.png"]) {
      const copy = previewSrc(src);
      expect(copy).toContain("/assets/img/resized/960/");
      const original = fullSrc(copy);
      expect(original).not.toContain("/resized/");
      expect(fullSrc(original)).toBe(original);
    }
  });
});

describe("photos added while the writer keeps typing", () => {
  const caretAt = (node: Node, offset: number) => {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  };

  it("go where they were added and leave the caret where the writer took it", async () => {
    load("First line\n\nSecond line");
    const first = root.querySelector("p")!.firstChild!;
    caretAt(first, 5);
    const adding = insertImages(root, [new File(["a"], "a.jpg", { type: "image/jpeg" })], () => true);
    first.textContent = "First typed line";
    root.dispatchEvent(new InputEvent("input", { bubbles: true }));
    caretAt(first, 11);
    await adding;
    expect([...root.children].map((child) => child.tagName)).toEqual(["P", "FIGURE", "P"]);
    expect(window.getSelection()?.getRangeAt(0).startContainer).toBe(first);
    expect(window.getSelection()?.getRangeAt(0).startOffset).toBe(11);
  });

  it("take the caret on below them when nothing was typed meanwhile", async () => {
    load("First line\n\nSecond line");
    caretAt(root.querySelector("p")!.firstChild!, 5);
    await insertImages(root, [new File(["a"], "a.jpg", { type: "image/jpeg" })], () => true);
    expect(root.children[1].tagName).toBe("FIGURE");
    expect(root.children[2].contains(window.getSelection()!.getRangeAt(0).startContainer)).toBe(true);
  });
});

describe("dragging photos about", () => {
  beforeEach(() => load("Top\n\n```gallery\n![a](/assets/img/post/a.webp)\n![b](/assets/img/post/b.webp)\n```\n\nMiddle\n\n![c](/assets/img/post/c.webp)\n\nEnd"));
  const figure = (alt: string) => root.querySelector<HTMLElement>(`figure[data-image]:has(img[alt="${alt}"])`)!;
  const block = (text: string) => [...root.children].find((child) => child.textContent === text) as HTMLElement;

  it("reorders a gallery", () => {
    expect(moveBlock(root, figure("a"), { kind: "photo", ref: figure("b"), side: "after" })).toBe(true);
    expect(stable()).toContain("```gallery\n![b](/assets/img/post/b.webp)\n![a](/assets/img/post/a.webp)\n```");
  });

  it("takes a photo out, and a gallery left with one photo is a plain photo", () => {
    moveBlock(root, figure("a"), { kind: "block", ref: block("End"), side: "after" });
    expect(stable()).toBe("Top\n\n![b](/assets/img/post/b.webp)\n\nMiddle\n\n![c](/assets/img/post/c.webp)\n\nEnd\n\n![a](/assets/img/post/a.webp)");
    expect(root.lastElementChild?.tagName).toBe("P");
  });

  it("makes a gallery of a photo dropped beside one alone", () => {
    moveBlock(root, figure("a"), { kind: "photo", ref: figure("c"), side: "before" });
    expect(stable()).toBe("Top\n\n![b](/assets/img/post/b.webp)\n\nMiddle\n\n```gallery\n![a](/assets/img/post/a.webp)\n![c](/assets/img/post/c.webp)\n```\n\nEnd");
  });

  it("moves a whole gallery, and never into itself or another", () => {
    const gallery = root.querySelector<HTMLElement>("[data-gallery]")!;
    expect(moveBlock(root, gallery, { kind: "photo", ref: figure("c"), side: "after" })).toBe(false);
    expect(moveBlock(root, gallery, { kind: "block", ref: block("Top"), side: "before" })).toBe(true);
    expect(stable()).toMatch(/^```gallery\n/);
  });

  it("copies a photo and pastes it into a gallery, address and alt as they were", () => {
    const { html, text } = clipboardOf([figure("c")]);
    const copied = copiedBlocks(html, text)!;
    selectFigure(root, figure("a"));
    insertDoc(root, copied);
    expect(stable()).toContain("```gallery\n![a](/assets/img/post/a.webp)\n![c](/assets/img/post/c.webp)\n![b](/assets/img/post/b.webp)\n```");
    expect(copiedBlocks("<p>from elsewhere</p>", "from elsewhere")).toBeNull();
    expect(copiedBlocks('<div data-write-blocks=""><p><a href="javascript:alert(1)">x</a></p></div>', "x")).toBeNull();
  });

  it("pastes a gallery or a paragraph on a gallery photo after the gallery, never into it", () => {
    const { html, text } = clipboardOf([root.querySelector("[data-gallery]")!, block("Middle")]);
    const copied = copiedBlocks(html, text)!;
    selectFigure(root, figure("a"));
    insertDoc(root, copied);
    expect(root.querySelectorAll("[data-gallery] [data-gallery], [data-gallery] p")).toHaveLength(0);
    expect(root.querySelectorAll(":scope > [data-gallery]")).toHaveLength(2);
  });

  it("moves a photo alone with its caption line and its attribute list", () => {
    load("Top\n\n![c](/assets/img/post/c.webp)\n*A caption*\n{: .light }\n\nEnd");
    const before = stable();
    expect(moveBlock(root, figure("c"), { kind: "block", ref: block("End"), side: "after" })).toBe(true);
    expect(stable()).toBe(`Top\n\nEnd\n\n${before.slice("Top\n\n".length, before.lastIndexOf("\n\nEnd"))}`);
  });
});
