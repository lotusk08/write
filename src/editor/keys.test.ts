// @vitest-environment happy-dom
import { sanitizeHtml } from "@erag/text-editor-vue";
import { beforeEach, describe, expect, it } from "vitest";
import { markdownToDoc } from "../lib/import.ts";
import { docToMarkdown } from "../lib/markdown.ts";
import { docToHtml, htmlToDoc } from "./bridge.ts";
import { embedFromUrl } from "./blog.ts";
import { insertFootnote, toggleCodeBlock, toggleFilepath, toggleInline, toggleList, togglePlainQuote } from "./commands.ts";
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

/** Selects the first run of `text`. */
function selectText(text: string): void {
  caretAfter(text);
  const range = window.getSelection()!.getRangeAt(0);
  range.setStart(range.startContainer, range.startOffset - text.length);
}

const WRAPS: Record<string, string> = { bold: "b", italic: "i", strikeThrough: "strike", createLink: "a" };

/** happy-dom has no `execCommand`: the few the shortcuts use, as Chrome does them (bold is `<b>`, a bare caret sets nothing, a list leaves the caret at the start of its line). */
function execCommand(command: string, _ui?: boolean, value?: string): boolean {
  const range = window.getSelection()?.getRangeAt(0);
  if (!range) {
    return false;
  }
  if (command === "insertText") {
    range.deleteContents();
    const node = range.startContainer;
    const text = value ?? "";
    if (node.nodeType === 3) {
      (node as Text).insertData(range.startOffset, text);
      range.setStart(node, range.startOffset + text.length);
    } else {
      const inserted = document.createTextNode(text);
      range.insertNode(inserted);
      range.setStart(inserted, text.length);
    }
    range.collapse(true);
    return true;
  }
  const listTag = { insertOrderedList: "ol", insertUnorderedList: "ul" }[command];
  const block = (range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement)?.closest("p");
  if (listTag && block) {
    const list = document.createElement(listTag);
    const item = document.createElement("li");
    item.append(...block.childNodes);
    list.append(item);
    block.replaceWith(list);
    const start = item.firstChild ?? item;
    window.getSelection()?.collapse(start, 0);
    return true;
  }
  const tag = WRAPS[command];
  if (!tag || range.collapsed) {
    return false;
  }
  const element = document.createElement(tag);
  if (value) {
    element.setAttribute("href", value);
  }
  range.surroundContents(element);
  range.selectNodeContents(element);
  return true;
}

beforeEach(() => {
  document.body.innerHTML = '<div contenteditable="true"></div>';
  root = document.body.firstElementChild as HTMLElement;
  Object.assign(document, { execCommand, queryCommandState: () => false });
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
    load("> a tip\n{: .tip}");
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
    ["**bold**", "b"],
    ["*soft*", "i"],
    ["_soft_", "i"],
    ["~~gone~~", "strike"],
    ["`code`", "code"],
  ] as const) {
    it(`${written} becomes <${tag}>`, () => {
      raw(`say ${written}`);
      caretAfter(written);
      typed(written.slice(-1));
      expect(root.querySelector(tag)?.textContent).toBe(written.replace(/[*_~`]/g, ""));
      expect(markdown()).toContain(tag === "i" ? "*soft*" : written);
    });
  }

  it("types on outside a bold WebKit keeps typing into", () => {
    raw("say **b**");
    caretAfter("**b**");
    typed("*");
    const bold = root.querySelector("b") as HTMLElement;
    bold.append(" c");
    typed("c");
    expect(markdown()).toBe("say **b** c");
  });

  it("leaves ==text== as typed, highlight being no tool any more", () => {
    raw("say ==bright==");
    caretAfter("==bright==");
    typed("=");
    expect(root.querySelector("mark")).toBeNull();
    expect(markdown()).toBe("say ==bright==");
  });

  it("types on outside a code it just made", () => {
    raw("say `x`");
    caretAfter("`x`");
    typed("`");
    const code = root.querySelector("code") as HTMLElement;
    code.append(" y");
    typed("y");
    expect(markdown()).toBe("say `x` y");
  });

  it("[text](address) becomes a link, an image's ![…](…) does not", () => {
    raw("see [t](https://x.com)");
    caretAfter(")");
    typed(")");
    expect(markdown()).toBe("see [t](https://x.com)");
    raw("![a](b.png)");
    caretAfter(")");
    typed(")");
    expect(root.querySelector("a")).toBeNull();
  });

  it("`x`{.path}, or `x`{: .path}, makes the code a file path", () => {
    for (const typedList of ["{.path}", "{: .path}"]) {
      raw("open `a/b`");
      caretAfter("`a/b`");
      typed("`");
      root.querySelector("code")?.after(typedList);
      caretAfter(typedList);
      typed("}");
      expect(markdown()).toBe("open `a/b`{.path}");
    }
  });

  it("leaves snake_case_names, spaced stars, half-closed bold and Vietnamese mid-word marks alone", () => {
    for (const text of ["snake_case_", "a * b *", "**half*", "Hồ_Chí_", "ồ*b*"]) {
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

  it("has no ⌘⇧H highlight", () => {
    load("word");
    const range = document.createRange();
    range.selectNodeContents(root.querySelector("p") as HTMLElement);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const event = new KeyboardEvent("keydown", { metaKey: true, shiftKey: true, code: "KeyH", key: "H" });
    expect(handleKeydown(root, event)).toBe(false);
    expect(markdown()).toBe("word");
  });

  it("leaves the editor's own ⌘B to it", () => {
    load("word");
    const event = new KeyboardEvent("keydown", { metaKey: true, code: "KeyB", key: "b" });
    expect(handleKeydown(root, event)).toBe(false);
  });
});

describe("line shortcuts", () => {
  const space = (text: string) => {
    raw(text);
    caretAfter(text);
    typed(" ");
  };

  it("- [x] makes a ticked task", () => {
    space("- [x] ");
    expect(root.querySelector("li")?.getAttribute("data-checked")).toBe("true");
  });

  it("3. starts a numbered list at 3, and 0. at 0", () => {
    space("3. ");
    expect(root.querySelector("ol")?.getAttribute("start")).toBe("3");
    load("0. zero\n1. one");
    expect(markdown()).toBe("0. zero\n1. one");
  });

  it("leaves the caret on the line a heading was made of, not in an empty item elsewhere", () => {
    load("- \n\nIntro");
    root.insertAdjacentHTML("beforeend", "<p>## </p>");
    caretAfter("## ");
    typed(" ");
    const at = window.getSelection()!.getRangeAt(0).startContainer;
    expect((at instanceof Element ? at : at.parentElement)?.closest("li")).toBeNull();
  });
});

describe("a list's attribute list", () => {
  it("stays with the list, not a level Tab makes or a part a toggle splits off", () => {
    load("- a\n- b\n- c\n{: .cols}");
    caretAfter("b");
    handleKeydown(root, new KeyboardEvent("keydown", { key: "Tab" }));
    expect(markdown()).toBe("- a\n  - b\n- c\n{: .cols}");
    load("- a\n- b\n- c\n{: .cols}");
    caretAfter("b");
    toggleList(root, "bullet");
    expect(markdown()).toBe("- a\n\nb\n\n- c\n{: .cols}");
    load("{: .cols}\n- a\n- b\n- c");
    caretAfter("b");
    toggleList(root, "bullet");
    expect(markdown()).toBe("{: .cols}\n- a\n\nb\n\n- c");
  });
});

describe("Backspace under a photo", () => {
  it("takes the photo and leaves its caption a line of its own", () => {
    load("Intro\n\n![a](/a.jpg)\n*A caption*");
    const range = document.createRange();
    range.setStart(root.querySelector("p[data-join] em")!.firstChild!, 0);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(handleKeydown(root, new KeyboardEvent("keydown", { key: "Backspace" }))).toBe(true);
    expect(markdown()).toBe("Intro\n\n*A caption*");
  });
});

describe("Tab in lists", () => {
  const tab = (shiftKey = false) => handleKeydown(root, new KeyboardEvent("keydown", { key: "Tab", shiftKey }));

  it("nests an item under the one above and lifts it back out", () => {
    load("- a\n- b\n- c");
    caretAfter("b");
    tab();
    expect(markdown()).toBe("- a\n  - b\n- c");
    tab(true);
    expect(markdown()).toBe("- a\n- b\n- c");
  });

  it("lifting an item takes the ones after it along, under it", () => {
    load("- a\n  - b\n  - c");
    caretAfter("b");
    tab(true);
    expect(markdown()).toBe("- a\n- b\n  - c");
  });
});

describe("toolbar commands", () => {
  it("highlight comes off only the selected part", () => {
    load("one <mark>two three</mark>");
    selectText("three");
    toggleInline(root, "mark");
    expect(markdown()).toBe("one <mark>two </mark>three");
  });

  it("highlight with nothing selected takes the word, and spans every block selected", () => {
    load("alpha beta\n\ngamma");
    caretAfter("be");
    toggleInline(root, "mark");
    expect(markdown()).toBe("alpha <mark>beta</mark>\n\ngamma");
    const range = document.createRange();
    range.setStart(root.querySelector("p")!.firstChild!, 0);
    range.setEnd(root.querySelectorAll("p")[1].firstChild!, 5);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    toggleInline(root, "code");
    expect(markdown()).toBe("`alpha `<mark>`beta`</mark>\n\n`gamma`");
  });

  it("a footnote goes after the selection rather than over it", () => {
    load("alpha beta");
    selectText("beta");
    insertFootnote(root);
    expect(markdown()).toBe("alpha beta[^1]\n\n[^1]:");
  });

  it("a list switches kind as a whole, and comes off as paragraphs", () => {
    load("- a\n- b");
    caretAfter("a");
    toggleList(root, "ordered");
    expect(markdown()).toBe("1. a\n2. b");
    toggleList(root, "task");
    expect(markdown()).toBe("- [ ] a\n- [ ] b");
    toggleList(root, "task");
    expect(markdown()).toBe("a\n\n- [ ] b");
  });

  it("a list made from a typed line keeps the caret where it was", () => {
    raw("one");
    caretAfter("one");
    toggleList(root, "bullet");
    const range = window.getSelection()!.getRangeAt(0);
    expect([range.startContainer.nodeValue, range.startOffset]).toEqual(["one", 3]);
  });

  it("a file path made from plain text is a file path, and a second press takes it off", () => {
    load("alpha beta gamma");
    selectText("beta");
    toggleFilepath(root);
    expect(markdown()).toBe("alpha `beta`{.path} gamma");
    toggleFilepath(root);
    expect(markdown()).toBe("alpha beta gamma");
  });

  it("a file path at a bare caret takes the whole path round it", () => {
    load("open src/main.ts now");
    caretAfter("src/ma");
    toggleFilepath(root);
    expect(markdown()).toBe("open `src/main.ts`{.path} now");
  });

  it("a code block comes off as one paragraph, a line break per line", () => {
    load("```\nl1\nl2\n```");
    caretAfter("l1");
    toggleCodeBlock(root);
    expect(markdown()).toBe("l1\nl2");
  });
});

describe("Enter in a code block", () => {
  const enter = () => handleKeydown(root, new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));

  it("breaks the line inside the block rather than splitting it in two", () => {
    load("```js\nab\n```");
    caretAfter("a");
    expect(enter()).toBe(true);
    expect(markdown()).toBe("```js\na\nb\n```");
    expect(root.querySelectorAll("pre")).toHaveLength(1);
  });

  it("leaves the block on an empty last line", () => {
    load("```js\nab\n```");
    caretAfter("ab");
    enter();
    expect(root.querySelectorAll("pre")).toHaveLength(1);
    enter();
    expect(markdown()).toBe("```js\nab\n```");
    expect(window.getSelection()!.getRangeAt(0).startContainer.parentElement?.closest("pre")).toBeNull();
  });
});

describe("embeds from a link", () => {
  it("knows audio and video files, and a YouTube id only at its length", () => {
    expect(embedFromUrl("https://example.com/a.mp3")).toEqual({ platform: "audio", id: "https://example.com/a.mp3" });
    expect(embedFromUrl("/assets/media/clip.mp4")).toEqual({ platform: "video", id: "/assets/media/clip.mp4" });
    expect(embedFromUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({ platform: "youtube", id: "dQw4w9WgXcQ" });
    expect(embedFromUrl("https://www.bilibili.com/video/BV1xx411c7mD")).toBeNull();
    expect(embedFromUrl("abcdefg")).toBeNull();
  });

  it("makes no Spotify player, which the blog no longer draws", () => {
    expect(embedFromUrl("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC")).toBeNull();
  });
});

describe("a heading merged into a paragraph", () => {
  it("leaves no span styled as the heading, and the caret where it was", () => {
    root.innerHTML = '<p>Some text<span style="font-size: 1.28em; letter-spacing: -0.02em; font-weight: 600;">Head</span></p>';
    caretAfter("Some text");
    handleInput(root, new InputEvent("input", { inputType: "deleteContentBackward" }));
    expect(root.innerHTML).toBe("<p>Some textHead</p>");
    expect(window.getSelection()?.getRangeAt(0).startOffset).toBe("Some text".length);
    expect(markdown()).toBe("Some textHead");
  });
});
