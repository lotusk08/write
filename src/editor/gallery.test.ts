// @vitest-environment happy-dom
import { sanitizeHtml } from "@erag/text-editor-vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markdownToDoc } from "../lib/import.ts";
import { docToMarkdown } from "../lib/markdown.ts";
import { fullSrc, previewSrc, setSiteUrl } from "../lib/site.ts";
import { docToHtml, htmlToDoc } from "./bridge.ts";
import { insertImages, leaveGallery, moveGalleryPhoto, removeGalleryPhoto, selectFigure, setImageText } from "./commands.ts";
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

  it("writes a caption as alt text and drops the title", () => {
    load('```gallery\n![old](/assets/img/post/a.webp "A title")\n![b](/assets/img/post/b.webp)\n```');
    setImageText(root, photos()[0], ' Sài Gòn "đêm" [1] ');
    expect(stable()).toBe('```gallery\n![Sài Gòn "đêm" \\[1\\]](/assets/img/post/a.webp)\n![b](/assets/img/post/b.webp)\n```');
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
