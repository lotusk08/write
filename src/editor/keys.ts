import {
  continueAfter,
  format,
  insertRule,
  keepCaretInNewItem,
  liftLists,
  currentTextblock,
  notify,
  placeCaret,
  selectionIn,
  setCollapsible,
  toggleCodeBlock,
  toggleHeading,
  toggleInline,
  toggleList,
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
 * `-`, `1.`, `[ ]`, `---`) turn it into what they write, as do `**bold**`,
 * `*italic*`, `~~strike~~`, `==highlight==` and `` `code` `` once closed.
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

type Command = (root: HTMLElement) => unknown;

const paragraph: Command = (root) => {
  document.execCommand("formatBlock", false, "p");
  notify(root);
};

/** The ⌘ shortcuts the Tiptap editor had, beyond the editor's own ⌘B, ⌘I, ⌘⇧X, ⌘K and undo. */
const KEYS: Record<string, Command> = {
  e: (root) => toggleInline(root, "code"),
  "shift+h": (root) => toggleInline(root, "mark"),
  ".": (root) => format(root, "superscript"),
  ",": (root) => format(root, "subscript"),
  "shift+7": (root) => toggleList(root, "ordered"),
  "shift+8": (root) => toggleList(root, "bullet"),
  "shift+9": (root) => toggleList(root, "task"),
  "shift+b": togglePlainQuote,
  "shift+d": (root) => unsetCollapsible(root) || setCollapsible(root),
  "alt+c": toggleCodeBlock,
  "alt+0": paragraph,
  "alt+1": (root) => toggleHeading(root, 2),
  "alt+2": (root) => toggleHeading(root, 2),
  "alt+3": (root) => toggleHeading(root, 3),
  "alt+4": (root) => toggleHeading(root, 4),
};

/** By the key's place, not its character: ⌥ and ⇧ change the character on a Mac. */
const keyName = (code: string) => code.replace(/^(?:Key|Digit)/, "").toLowerCase().replace("period", ".").replace("comma", ",");

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
  const key = mod && KEYS[`${event.altKey ? "alt+" : ""}${event.shiftKey ? "shift+" : ""}${keyName(event.code)}`];
  if (key) {
    event.preventDefault();
    key(root);
    return true;
  }
  return false;
}

type Shortcut = (root: HTMLElement) => void;

const TASK = /^(?:[-*] )?\[[ xX]?\] $/;

const SHORTCUTS: [RegExp, Shortcut][] = [
  [/^#{1,2} $/, () => document.execCommand("formatBlock", false, "h2")],
  [/^### $/, () => document.execCommand("formatBlock", false, "h3")],
  [/^#### $/, () => document.execCommand("formatBlock", false, "h4")],
  [/^(?:>>>|:::) $/, (root) => setCollapsible(root)],
  [/^> $/, (root) => togglePlainQuote(root)],
  [/^[-*] $/, () => document.execCommand("insertUnorderedList")],
  [/^1[.)] $/, () => document.execCommand("insertOrderedList")],
  [TASK, (root) => toggleList(root, "task")],
  [/^(?:---|\*\*\*|___) $/, insertRule],
];

const MARKS: [RegExp, string][] = [
  [/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, "strong"],
  [/(?<![*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, "em"],
  [/(?<![_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, "em"],
  [/~~([^~\s](?:[^~]*[^~\s])?)~~$/, "s"],
  [/==([^=\s](?:[^=]*[^=\s])?)==$/, "mark"],
  [/`([^`]+)`$/, "code"],
];

/** A mark typed in Markdown, turned into the mark once its closing character is typed. */
function markShortcut(root: HTMLElement): boolean {
  const range = selectionIn(root);
  const node = range?.startContainer;
  if (!range?.collapsed || node?.nodeType !== 3 || node.parentElement?.closest("code, pre")) {
    return false;
  }
  const text = (node as Text).data.slice(0, range.startOffset);
  for (const [pattern, tag] of MARKS) {
    const found = pattern.exec(text);
    if (found) {
      const mark = document.createElement(tag);
      mark.textContent = found[1];
      range.setStart(node, range.startOffset - found[0].length);
      range.deleteContents();
      range.insertNode(mark);
      range.setStartAfter(mark);
      range.collapse(true);
      return true;
    }
  }
  return false;
}

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
  if (event.inputType !== "insertText") {
    return;
  }
  if (event.data && "*_~=`".includes(event.data)) {
    if (markShortcut(root)) {
      notify(root);
    }
    return;
  }
  const block = currentTextblock(root);
  if (event.data !== " " || !block) {
    return;
  }
  const text = (block.textContent ?? "").replace(/\u00a0/g, " ");
  const shortcut = SHORTCUTS.find(([pattern]) => pattern.test(text) && (flows(root, block) || (pattern === TASK && block.closest("li"))));
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
