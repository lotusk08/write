import {
  continueAfter,
  keepCaretInNewItem,
  liftLists,
  currentTextblock,
  notify,
  placeCaret,
  selectionIn,
  setCollapsible,
  togglePlainQuote,
  unsetCollapsible,
} from "./commands.ts";

/**
 * Typing, as the blog writes. Enter is a line break and Enter on the line it
 * just made starts a paragraph, because a phone keyboard has no Shift+Enter
 * and every line of a poem became a paragraph of its own; only where a
 * paragraph flows — in the document, a quote or a section, not a list item or
 * a cell — and a cell moves to the one below instead, since a cell is one line
 * of pipes in the Markdown. A line that is only a fence opener becomes a code
 * block, and the Markdown shortcuts at the start of a line (`#`, `>`, `>>>`,
 * `-`, `1.`) turn it into what they write.
 */

const FLOWING = "blockquote, [data-collapsible-content]";

const FENCE_OPENER = /^(?:`{3,}|~{3,})([^`]*)$/;

const BLOCK_DATA = ["data-block-ial", "data-ial-above", "data-join", "data-same-line", "data-lazy"];

function flows(root: HTMLElement, block: HTMLElement): boolean {
  const parent = block.parentElement;
  return block.tagName === "P" && (parent === root || Boolean(parent?.matches(FLOWING)));
}

function caretAtEnd(block: HTMLElement, range: Range): boolean {
  const rest = document.createRange();
  rest.setStart(range.endContainer, range.endOffset);
  rest.setEnd(block, block.childNodes.length);
  return rest.toString() === "" && !rest.cloneContents().querySelector("img, sup, input");
}

function nodeBefore(range: Range): Node | null {
  const { startContainer, startOffset } = range;
  if (startContainer.nodeType === 3) {
    return startOffset === 0 ? startContainer.previousSibling : null;
  }
  return startContainer.childNodes[startOffset - 1] ?? null;
}

/** The nodes of the block's last line: everything after its last top-level `<br>`. */
function lastLine(block: HTMLElement): { breakNode: Element | null; nodes: Node[] } {
  const children = [...block.childNodes];
  while (children.length && children[children.length - 1].nodeName === "BR") {
    children.pop();
  }
  const at = children.map((node) => node.nodeName).lastIndexOf("BR");
  return { breakNode: at === -1 ? null : (children[at] as Element), nodes: children.slice(at + 1) };
}

function fenceToCode(block: HTMLElement): boolean {
  const { breakNode, nodes } = lastLine(block);
  const text = nodes.map((node) => node.textContent ?? "").join("").replace(/\u00a0/g, " ");
  const fence = FENCE_OPENER.exec(text.trim());
  if (!fence) {
    return false;
  }
  const pre = document.createElement("pre");
  const language = fence[1].trim();
  if (language) {
    pre.setAttribute("data-language", language);
  }
  const code = document.createElement("code");
  code.append(document.createElement("br"));
  pre.append(code);
  if (breakNode) {
    nodes.forEach((node) => node.parentNode?.removeChild(node));
    breakNode.remove();
    block.after(pre);
  } else {
    block.replaceWith(pre);
  }
  placeCaret(code, false);
  return true;
}

/**
 * A `<br>` placed by hand: WebKit's `insertLineBreak` writes a bare newline
 * into a `white-space: pre-wrap` block rather than an element. One that ends
 * the block gets the placeholder after it, or the browser would not show the
 * empty line it opens.
 */
function insertBreak(root: HTMLElement, block: HTMLElement, range: Range): void {
  const br = document.createElement("br");
  range.insertNode(br);
  const rest = document.createRange();
  rest.setStartAfter(br);
  rest.setEnd(block, block.childNodes.length);
  if (rest.toString() === "" && !rest.cloneContents().querySelector("br, img, sup")) {
    br.after(document.createElement("br"));
  }
  const caret = document.createRange();
  caret.setStartAfter(br);
  caret.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(caret);
  notify(root);
}

function cellBelow(root: HTMLElement, cell: HTMLTableCellElement): boolean {
  const row = cell.parentElement as HTMLTableRowElement | null;
  const table = cell.closest("table");
  if (!row || !table) {
    return false;
  }
  const rows = [...table.querySelectorAll("tr")].filter((item) => item.closest("table") === table);
  const next = rows[rows.indexOf(row) + 1];
  const target = next?.cells[cell.cellIndex] ?? next?.cells[next.cells.length - 1];
  if (target) {
    placeCaret(target);
  } else {
    continueAfter(table);
    notify(root);
  }
  return true;
}

function enter(root: HTMLElement): boolean {
  const range = selectionIn(root);
  const block = currentTextblock(root);
  if (!range || !block) {
    return false;
  }
  if (block.matches("td, th")) {
    return cellBelow(root, block as HTMLTableCellElement);
  }
  if (block.matches("[data-collapsible-summary]")) {
    const body = block.parentElement?.querySelector(":scope > [data-collapsible-content]");
    const first = body?.firstElementChild;
    if (first) {
      placeCaret(first, false);
    }
    return true;
  }
  if (!flows(root, block)) {
    return false;
  }
  if (!range.collapsed) {
    range.deleteContents();
  }
  const atEnd = caretAtEnd(block, range);
  if (atEnd && fenceToCode(block)) {
    notify(root);
    return true;
  }
  const empty = !block.textContent?.replace(/\u200b/g, "") && !block.querySelector("img, sup");
  const quote = block.parentElement?.closest("blockquote");
  if (empty && quote && block === quote.lastElementChild && quote.parentElement) {
    quote.after(block);
    placeCaret(block, false);
    notify(root);
    return true;
  }
  const before = nodeBefore(range);
  if (atEnd && before?.nodeName === "BR") {
    before.parentNode?.removeChild(before);
    document.execCommand("insertParagraph");
    return true;
  }
  insertBreak(root, block, range);
  return true;
}

/** Returns true when the key was taken, so the caller can stop the editor from acting on it too. */
export function handleKeydown(root: HTMLElement, event: KeyboardEvent): boolean {
  if (event.isComposing || event.keyCode === 229) {
    return false;
  }
  const mod = event.metaKey || event.ctrlKey;
  if (event.key === "Enter" && !event.shiftKey && !mod && !event.altKey) {
    if (enter(root)) {
      event.preventDefault();
      return true;
    }
    return false;
  }
  if (mod && event.shiftKey && event.key.toLowerCase() === "d") {
    event.preventDefault();
    if (!unsetCollapsible(root)) {
      setCollapsible(root);
    }
    return true;
  }
  if (mod && event.altKey && event.code === "Digit1") {
    event.preventDefault();
    const block = currentTextblock(root);
    document.execCommand("formatBlock", false, block?.tagName === "H2" ? "p" : "h2");
    notify(root);
    return true;
  }
  return false;
}

type Shortcut = (root: HTMLElement) => void;

const SHORTCUTS: [RegExp, Shortcut][] = [
  [/^#{1,2} $/, () => document.execCommand("formatBlock", false, "h2")],
  [/^### $/, () => document.execCommand("formatBlock", false, "h3")],
  [/^#### $/, () => document.execCommand("formatBlock", false, "h4")],
  [/^(?:>>>|:::) $/, (root) => setCollapsible(root)],
  [/^> $/, (root) => togglePlainQuote(root)],
  [/^[-*] $/, () => document.execCommand("insertUnorderedList")],
  [/^1[.)] $/, () => document.execCommand("insertOrderedList")],
];

/** After the editor has applied a keystroke: Markdown shortcuts, and a new block not inheriting the old one's layout. */
export function handleInput(root: HTMLElement, event: InputEvent): void {
  if (liftLists(root)) {
    notify(root);
    return;
  }
  if (event.inputType === "insertParagraph") {
    const block = currentTextblock(root);
    BLOCK_DATA.forEach((name) => block?.removeAttribute(name));
    return;
  }
  if (event.inputType !== "insertText" || event.data !== " ") {
    return;
  }
  const block = currentTextblock(root);
  if (!block || !flows(root, block)) {
    return;
  }
  const text = (block.textContent ?? "").replace(/\u00a0/g, " ");
  const shortcut = SHORTCUTS.find(([pattern]) => pattern.test(text));
  if (!shortcut) {
    return;
  }
  block.replaceChildren(document.createElement("br"));
  placeCaret(block, false);
  shortcut[1](root);
  liftLists(root);
  keepCaretInNewItem(root);
  notify(root);
}
