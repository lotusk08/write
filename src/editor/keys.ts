import {
  continueAfter,
  format,
  freeCaption,
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

const FLOWING = "blockquote, [data-collapsible-content], [data-footnote]";

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
  if (!pre.nextElementSibling) {
    const after = document.createElement("p");
    after.append(document.createElement("br"));
    pre.after(after);
  }
  placeCaret(code, false);
  return true;
}

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
  const pre = block.closest("pre");
  if (pre) {
    const before = nodeBefore(range);
    if (range.collapsed && caretAtEnd(pre, range) && before?.nodeName === "BR") {
      before.parentNode?.removeChild(before);
      continueAfter(pre);
      notify(root);
      return true;
    }
    if (!range.collapsed) {
      range.deleteContents();
    }
    insertBreak(root, pre, range);
    return true;
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
  const container = block.parentElement;
  const leaving = container?.matches("blockquote") ? container : container?.closest("[data-collapsible]");
  if (empty && leaving && container !== root && block === container?.lastElementChild && leaving.parentElement) {
    leaving.after(block);
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

const KEYS: Record<string, Command> = {
  e: (root) => toggleInline(root, "code"),
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

function keepingCaret(move: () => void): void {
  const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
  const caret = range ? { node: range.startContainer, offset: range.startOffset } : null;
  move();
  if (caret?.node.isConnected) {
    const restored = document.createRange();
    restored.setStart(caret.node, caret.offset);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(restored);
  }
}

function tab(root: HTMLElement, out: boolean): boolean {
  const block = currentTextblock(root);
  if (!block) {
    return false;
  }
  if (block.closest("pre")) {
    if (!out) {
      document.execCommand("insertText", false, "  ");
    }
    return true;
  }
  const item = block.closest("li");
  const list = item?.parentElement;
  if (!item || !list || block.closest("td, th")) {
    return false;
  }
  const nested = (holder: Element) => {
    const last = holder.lastElementChild;
    if (last?.tagName === list.tagName) {
      return last;
    }
    const sub = list.cloneNode(false) as HTMLElement;
    ["start", "data-block-ial", "data-ial-above"].forEach((name) => sub.removeAttribute(name));
    holder.append(sub);
    return sub;
  };
  if (!out) {
    const previous = item.previousElementSibling;
    if (previous?.tagName === "LI") {
      keepingCaret(() => nested(previous).append(item));
    }
    return true;
  }
  const parentItem = list.parentElement;
  if (parentItem?.tagName !== "LI" || !root.contains(parentItem)) {
    return true;
  }
  keepingCaret(() => {
    const rest = [...list.children].slice([...list.children].indexOf(item) + 1);
    if (rest.length) {
      nested(item).append(...rest);
    }
    parentItem.after(item);
    if (!list.children.length) {
      list.remove();
    }
  });
  return true;
}

function removePhotoBefore(root: HTMLElement): boolean {
  const range = selectionIn(root);
  const block = currentTextblock(root);
  const photo = block?.previousElementSibling;
  if (!range?.collapsed || !block || !photo?.matches("figure[data-image]")) {
    return false;
  }
  const start = document.createRange();
  start.setStart(block, 0);
  start.setEnd(range.startContainer, range.startOffset);
  if (start.toString() !== "" || start.cloneContents().querySelector("img, br, sup")) {
    return false;
  }
  freeCaption(photo as HTMLElement);
  photo.remove();
  placeCaret(block, false);
  notify(root);
  return true;
}

const keyName = (code: string) => code.replace(/^(?:Key|Digit)/, "").toLowerCase().replace("period", ".").replace("comma", ",");

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
  const cellMark = mod && !event.altKey && !event.shiftKey && { KeyB: "bold", KeyI: "italic" }[event.code];
  if (cellMark && currentTextblock(root)?.matches("td, th")) {
    event.preventDefault();
    format(root, cellMark);
    return true;
  }
  if (event.key === "Tab" && !mod && !event.altKey && tab(root, event.shiftKey)) {
    event.preventDefault();
    return true;
  }
  if (event.key === "Backspace" && !mod && !event.altKey && removePhotoBefore(root)) {
    event.preventDefault();
    return true;
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

const NUMBERED = /^(\d{1,9})[.)] $/;

const BULLET = /^[-*] $/;

const SHORTCUTS: [RegExp, Shortcut][] = [
  [/^#{1,2} $/, () => document.execCommand("formatBlock", false, "h2")],
  [/^### $/, () => document.execCommand("formatBlock", false, "h3")],
  [/^#### $/, () => document.execCommand("formatBlock", false, "h4")],
  [/^(?:>>>|:::) $/, (root) => setCollapsible(root)],
  [/^> $/, (root) => togglePlainQuote(root)],
  [BULLET, () => document.execCommand("insertUnorderedList")],
  [NUMBERED, () => document.execCommand("insertOrderedList")],
  [TASK, (root) => toggleList(root, "task")],
  [/^(?:---|\*\*\*|___) $/, insertRule],
];

const MARKS: [RegExp, string][] = [
  [/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/u, "strong"],
  [/(?<![*\p{L}\p{N}])\*([^*\s](?:[^*]*[^*\s])?)\*$/u, "em"],
  [/(?<![_\p{L}\p{N}])_([^_\s](?:[^_]*[^_\s])?)_$/u, "em"],
  [/~~([^~\s](?:[^~]*[^~\s])?)~~$/u, "s"],
  [/`([^`]+)`$/u, "code"],
];

const LINK = /(?<!!)\[([^\]\n]+)\]\(([^()\s]+)\)$/;

const FILEPATH = /^\{\s*\.path\s*\}$/;

const COMMANDS: Record<string, string> = { strong: "bold", em: "italic", s: "strikeThrough" };

const made = new WeakMap<HTMLElement, { mark: Element; text: string }>();

function moveTypingOut(root: HTMLElement): void {
  const pending = made.get(root);
  if (!pending) {
    return;
  }
  const { mark, text } = pending;
  const now = mark.textContent ?? "";
  if (!mark.isConnected || now === text) {
    return;
  }
  made.delete(root);
  if (!now.startsWith(text)) {
    return;
  }
  const outside = document.createTextNode(now.slice(text.length));
  mark.textContent = text;
  mark.after(outside);
  const range = document.createRange();
  range.setStart(outside, outside.length);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  notify(root);
}

function typedMark(text: string): { tag: string; inner: string; href?: string; length: number } | null {
  const link = LINK.exec(text);
  if (link) {
    return { tag: "a", inner: link[1], href: link[2], length: link[0].length };
  }
  for (const [pattern, tag] of MARKS) {
    const found = pattern.exec(text);
    if (found) {
      return { tag, inner: found[1], length: found[0].length };
    }
  }
  return null;
}

function select(range: Range): void {
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

function markShortcut(root: HTMLElement): boolean {
  const range = selectionIn(root);
  const node = range?.startContainer;
  if (!range?.collapsed || node?.nodeType !== 3 || node.parentElement?.closest("code, pre, a")) {
    return false;
  }
  const text = (node as Text).data.slice(0, range.startOffset);
  const previous = node.previousSibling;
  if (previous?.nodeName === "CODE" && FILEPATH.test(text)) {
    (node as Text).deleteData(0, range.startOffset);
    (previous as Element).classList.add("filepath");
    const caret = document.createRange();
    caret.setStart(node, 0);
    select(caret);
    made.set(root, { mark: previous as Element, text: previous.textContent ?? "" });
    return true;
  }
  const typed = typedMark(text);
  if (!typed) {
    return false;
  }
  const replaced = document.createRange();
  replaced.setStart(node, range.startOffset - typed.length);
  replaced.setEnd(node, range.startOffset);
  select(replaced);
  document.execCommand("insertText", false, typed.inner);
  const caret = selectionIn(root);
  if (!caret || caret.startContainer.nodeType !== 3 || caret.startOffset < typed.inner.length) {
    return true;
  }
  const inner = document.createRange();
  inner.setStart(caret.startContainer, caret.startOffset - typed.inner.length);
  inner.setEnd(caret.startContainer, caret.startOffset);
  select(inner);
  const command = typed.tag === "a" ? "createLink" : COMMANDS[typed.tag];
  if (command) {
    document.execCommand(command, false, typed.href);
    const focus = window.getSelection()?.focusNode;
    const mark = (focus?.nodeType === 1 ? (focus as Element) : focus?.parentElement)?.closest("b, strong, i, em, s, strike, del");
    window.getSelection()?.collapseToEnd();
    if (typed.tag !== "a" && document.queryCommandState(command)) {
      document.execCommand(command);
    }
    if (mark && root.contains(mark)) {
      made.set(root, { mark, text: mark.textContent ?? "" });
    }
    return true;
  }
  const mark = document.createElement(typed.tag);
  inner.surroundContents(mark);
  const after = document.createRange();
  after.setStartAfter(mark);
  select(after);
  made.set(root, { mark, text: typed.inner });
  return true;
}

function unstyleMerge(root: HTMLElement): boolean {
  const block = currentTextblock(root);
  const spans = block
    ? [...block.querySelectorAll<HTMLElement>("span[style]")].filter((span) =>
        /font-size|letter-spacing|font-variant/.test(span.getAttribute("style") ?? ""),
      )
    : [];
  if (!spans.length) {
    return false;
  }
  const selection = window.getSelection();
  const at = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const caret = at ? ([at.startContainer, at.startOffset] as const) : null;
  for (const span of spans) {
    span.replaceWith(...span.childNodes);
  }
  if (caret && caret[0].isConnected) {
    const range = document.createRange();
    range.setStart(caret[0], caret[1]);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  return true;
}

export function handleInput(root: HTMLElement, event: InputEvent): void {
  if (!event.isComposing) {
    moveTypingOut(root);
  }
  if (liftLists(root)) {
    notify(root);
    return;
  }
  if (event.inputType === "insertParagraph") {
    const block = currentTextblock(root);
    const inherited = BLOCK_DATA.filter((name) => block?.hasAttribute(name));
    inherited.forEach((name) => block?.removeAttribute(name));
    const ticked = block?.matches("[data-task-list] > li[data-checked='true']");
    if (ticked) {
      block?.setAttribute("data-checked", "false");
    }
    if (inherited.length || ticked) {
      notify(root);
    }
    return;
  }
  if (event.inputType.startsWith("delete")) {
    if (unstyleMerge(root)) {
      notify(root);
    }
    return;
  }
  if (event.inputType !== "insertText") {
    return;
  }
  if (event.data && "*_~=`)}".includes(event.data)) {
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
  if (shortcut[0] === BULLET || shortcut[0] === NUMBERED || shortcut[0] === TASK) {
    keepCaretInNewItem(root);
  }
  const item = currentTextblock(root)?.closest("li");
  if (shortcut[0] === TASK && /\[[xX]\]/.test(text)) {
    item?.setAttribute("data-checked", "true");
  }
  const start = NUMBERED.exec(text)?.[1];
  const list = item?.parentElement;
  if (start && start !== "1" && list?.tagName === "OL") {
    list.setAttribute("start", String(Number(start)));
  }
  notify(root);
}
