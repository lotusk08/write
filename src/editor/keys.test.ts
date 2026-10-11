// @vitest-environment happy-dom
import { sanitizeHtml } from "@erag/text-editor-vue";
import { beforeEach, describe, expect, it } from "vitest";
import { markdownToDoc } from "../lib/import.ts";
import { docToMarkdown } from "../lib/markdown.ts";
import { docToHtml, htmlToDoc } from "./bridge.ts";
import { togglePlainQuote } from "./commands.ts";
import { sanitizerOptions } from "./config.ts";
import { handleInput, handleKeydown } from "./keys.ts";

let root: HTMLElement;

const markdown = () => docToMarkdown(htmlToDoc(sanitizeHtml(root.innerHTML, sanitizerOptions)));

function load(text: string): void {
  root.innerHTML = docToHtml(markdownToDoc(text), { display: (src) => src });
}

/** A paragraph holding `text` as typed, before any shortcut has read it. */
function raw(text: string): void {
  root.innerHTML = "<p></p>";
  root.firstElementChild?.append(text);
}

/** Puts the caret at the end of the first text that holds `text`. */
function caretAfter(text: string): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = (node as Text).data.indexOf(text);
    if (at !== -1) {
      const range = document.createRange();
      range.setStart(node, at + text.length);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      return;
    }
  }
  throw new Error(`no text ${text}`);
}

const typed = (data: string) => handleInput(root, new InputEvent("input", { inputType: "insertText", data }));

beforeEach(() => {
  document.body.innerHTML = '<div contenteditable="true"></div>';
  root = document.body.firstElementChild as HTMLElement;
});

describe("quotes", () => {
  it("quotes a paragraph and lifts it again", () => {
    load("one\n\ntwo");
    caretAfter("two");
    togglePlainQuote(root);
    expect(markdown()).toBe("one\n\n> two");
    togglePlainQuote(root);
    expect(markdown()).toBe("one\n\ntwo");
  });

  it("⌘⇧B quotes, and a callout loses its kind", () => {
    load("> a tip\n{: .note-tip}");
    caretAfter("a tip");
    handleKeydown(root, new KeyboardEvent("keydown", { metaKey: true, shiftKey: true, code: "KeyB", key: "B" }));
    expect(markdown()).toBe("> a tip");
  });

  it("reads back a quote holding a photo, a list and a nested quote", () => {
    const text = "> ![Hồ Gươm](/assets/img/post/a.webp)\n>\n> - item\n>\n> > inner";
    load(text);
    expect(markdown()).toBe(text);
  });
});

describe("marks typed in Markdown", () => {
  for (const [written, tag] of [
    ["**bold**", "strong"],
    ["*soft*", "em"],
    ["_soft_", "em"],
    ["~~gone~~", "s"],
    ["==bright==", "mark"],
    ["`code`", "code"],
  ] as const) {
    it(`${written} becomes <${tag}>`, () => {
      raw(`say ${written}`);
      caretAfter(written);
      typed(written.slice(-1));
      expect(root.querySelector(tag)?.textContent).toBe(written.replace(/[*_~=`]/g, ""));
      expect(markdown()).toContain(tag === "em" ? "*soft*" : tag === "mark" ? "<mark>bright</mark>" : written);
    });
  }

  it("leaves snake_case_names, spaced stars and half-closed bold alone", () => {
    for (const text of ["snake_case_", "a * b *", "**half*"]) {
      raw(text);
      caretAfter(text);
      typed(text.slice(-1));
      expect(root.querySelector("em, strong")).toBeNull();
    }
  });

  it("does nothing inside code", () => {
    load("```\n**x**\n```");
    caretAfter("**x**");
    typed("*");
    expect(root.querySelector("strong")).toBeNull();
  });
});

describe("⌘ shortcuts", () => {
  it("⌘E is inline code", () => {
    load("word");
    const range = document.createRange();
    range.selectNodeContents(root.querySelector("p") as HTMLElement);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    handleKeydown(root, new KeyboardEvent("keydown", { metaKey: true, code: "KeyE", key: "e" }));
    expect(markdown()).toBe("`word`");
  });

  it("leaves the editor's own ⌘B to it", () => {
    load("word");
    const event = new KeyboardEvent("keydown", { metaKey: true, code: "KeyB", key: "b" });
    expect(handleKeydown(root, event)).toBe(false);
  });
});
