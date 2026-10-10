import { imageStore, LOCAL_PREFIX, storeImageFile } from "../lib/db.ts";
import { CENTER_ROW, withoutRowClasses, withRowClasses, type GalleryKind, type NoteType } from "./blog.ts";
import { docToHtml } from "./bridge.ts";
import type { JSONContent } from "./doc.ts";

/**
 * The blog's own blocks, edited straight on the editor's DOM. The editor
 * (text-editor-vue) keeps its content as HTML and offers the common formatting
 * itself; what it has no command for — callouts, sections, photo rows,
 * galleries, footnotes, players — is done here, in the same HTML `bridge.ts`
 * reads back. Every command ends with `notify`, which is how the editor learns
 * its content changed under it.
 */

const ROW_LIMIT = 4;

const TEXTBLOCK = "p, h1, h2, h3, h4, h5, h6, pre, li, td, th, [data-collapsible-summary]";

/** Containers whose children are blocks laid one under another, as the document's own are. */
const FLOW = "blockquote, [data-collapsible-content], [data-footnote], li, td, th";

const CENTERABLE = "p, h1, h2, h3, h4, h5, h6, blockquote, table, ul, ol, pre";

const selectedFigures = new WeakMap<HTMLElement, HTMLElement>();

export function notify(root: HTMLElement): void {
  root.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

function elementOf(node: Node | null): Element | null {
  return node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
}

export function selectionIn(root: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return null;
  }
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer) ? range : null;
}

function anchor(root: HTMLElement): Element | null {
  const range = selectionIn(root);
  return range ? elementOf(range.startContainer) : null;
}

function closestIn(root: HTMLElement, from: Element | null, selector: string): HTMLElement | null {
  const found = from?.closest<HTMLElement>(selector) ?? null;
  return found && found !== root && root.contains(found) ? found : null;
}

export function currentTextblock(root: HTMLElement): HTMLElement | null {
  return closestIn(root, anchor(root), TEXTBLOCK);
}

/** The block a block command acts on: the one sitting directly in the document or in a quote, section or note. */
function flowBlock(root: HTMLElement): HTMLElement | null {
  let node = anchor(root);
  while (node && node !== root) {
    const parent = node.parentElement;
    if (parent === root || (parent && parent.matches(FLOW) && root.contains(parent))) {
      return node as HTMLElement;
    }
    node = parent;
  }
  return null;
}

export function placeCaret(node: Node, atEnd = true): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const last = node.lastChild;
  if (atEnd && last?.nodeName === "BR") {
    range.setEndBefore(last);
  }
  range.collapse(!atEnd);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function fragmentOf(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function emptyParagraph(): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.append(document.createElement("br"));
  return paragraph;
}

function isEmptyParagraph(node: Element | null): boolean {
  return node?.tagName === "P" && !node.textContent?.trim() && !node.querySelector("img, sup");
}

function unwrap(element: Element): void {
  element.replaceWith(...element.childNodes);
}

/** Puts the caret in the paragraph after `node`, making one when none follows. */
export function continueAfter(node: Element): void {
  let next = node.nextElementSibling;
  if (next?.tagName !== "P") {
    next = emptyParagraph();
    node.after(next);
  }
  placeCaret(next, false);
}

// ------------------------------------------------------------- selected photo

export function selectFigure(root: HTMLElement, figure: HTMLElement | null): void {
  selectedFigures.get(root)?.classList.remove("is-selected");
  if (figure) {
    figure.classList.add("is-selected");
    selectedFigures.set(root, figure);
  } else {
    selectedFigures.delete(root);
  }
}

function selectedFigure(root: HTMLElement): HTMLElement | null {
  const figure = selectedFigures.get(root) ?? null;
  return figure && root.contains(figure) ? figure : null;
}

// --------------------------------------------------------------------- inline

/** Wraps the selection in `tag`, or lifts the one the caret is in. */
export function toggleInline(root: HTMLElement, tag: string): boolean {
  const range = selectionIn(root);
  if (!range) {
    return false;
  }
  const existing = closestIn(root, elementOf(range.commonAncestorContainer), tag);
  if (existing) {
    unwrap(existing);
    notify(root);
    return true;
  }
  const start = closestIn(root, elementOf(range.startContainer), TEXTBLOCK);
  if (range.collapsed || !start || start !== closestIn(root, elementOf(range.endContainer), TEXTBLOCK)) {
    return false;
  }
  const element = document.createElement(tag);
  element.append(range.extractContents());
  range.insertNode(element);
  window.getSelection()?.selectAllChildren(element);
  notify(root);
  return true;
}

/** The blog's `{: .filepath}` code: plain code gains the class, a file path loses its code. */
export function toggleFilepath(root: HTMLElement): boolean {
  const code = closestIn(root, anchor(root), "code");
  if (code && !code.closest("pre")) {
    if (code.classList.contains("filepath")) {
      unwrap(code);
    } else {
      code.classList.add("filepath");
    }
    notify(root);
    return true;
  }
  if (!toggleInline(root, "code")) {
    return false;
  }
  closestIn(root, anchor(root), "code")?.classList.add("filepath");
  notify(root);
  return true;
}

export function insertFootnote(root: HTMLElement): boolean {
  const range = selectionIn(root);
  if (!range || closestIn(root, anchor(root), "[data-footnote]") || !currentTextblock(root)) {
    return false;
  }
  const used = new Set(
    [...root.querySelectorAll("[data-footnote-ref], [data-footnote]")].map(
      (node) => node.getAttribute("data-footnote-ref") ?? node.getAttribute("data-footnote"),
    ),
  );
  let number = 1;
  while (used.has(String(number))) {
    number += 1;
  }
  const label = String(number);
  range.deleteContents();
  const ref = fragmentOf(docToHtml({ type: "doc", content: [{ type: "paragraph", content: [{ type: "footnoteRef", attrs: { label } }] }] }))
    .querySelector("sup");
  if (ref) {
    range.insertNode(ref);
  }
  const definition = document.createElement("div");
  definition.className = "footnote";
  definition.setAttribute("data-footnote", label);
  const body = emptyParagraph();
  definition.append(body);
  root.append(definition);
  placeCaret(body, false);
  definition.scrollIntoView({ block: "nearest" });
  notify(root);
  return true;
}

// ---------------------------------------------------------------------- quote

export function quoteAt(root: HTMLElement): HTMLElement | null {
  return closestIn(root, selectedFigure(root) ?? anchor(root), "blockquote");
}

/** The quote button: a callout loses its kind, a plain quote is lifted, anything else is quoted. */
export function togglePlainQuote(root: HTMLElement): boolean {
  const quote = quoteAt(root);
  if (quote?.hasAttribute("data-note")) {
    quote.removeAttribute("data-note");
  } else if (quote) {
    unwrap(quote);
  } else if (!wrapInQuote(root)) {
    return false;
  }
  notify(root);
  return true;
}

function wrapInQuote(root: HTMLElement): HTMLElement | null {
  const block = flowBlock(root);
  if (!block) {
    return null;
  }
  const quote = document.createElement("blockquote");
  block.replaceWith(quote);
  quote.append(block);
  placeCaret(block);
  return quote;
}

/** A callout of the blog's: `{: .prompt-tip }` and the rest, or `{: .author }`. Picking the current kind takes it off. */
export function setNote(root: HTMLElement, note: NoteType): boolean {
  const quote = quoteAt(root) ?? wrapInQuote(root);
  if (!quote) {
    return false;
  }
  if (quote.getAttribute("data-note") === note) {
    quote.removeAttribute("data-note");
  } else {
    quote.setAttribute("data-note", note);
  }
  notify(root);
  return true;
}

// ------------------------------------------------------------------- sections

export function collapsibleAt(root: HTMLElement): HTMLElement | null {
  return closestIn(root, anchor(root), "[data-collapsible]");
}

export function setCollapsible(root: HTMLElement): boolean {
  const block = currentTextblock(root);
  const parent = block?.parentElement;
  if (!block || !parent || !/^(P|H[1-6])$/.test(block.tagName) || !(parent === root || parent.matches(FLOW))) {
    return false;
  }
  const text = block.textContent?.trim() ?? "";
  const section = fragmentOf(
    docToHtml({
      type: "doc",
      content: [
        {
          type: "collapsible",
          attrs: { open: true },
          content: [
            { type: "collapsibleSummary", content: text ? [{ type: "text", text }] : [] },
            { type: "collapsibleContent", content: [{ type: "paragraph" }] },
          ],
        },
      ],
    }),
  ).firstElementChild as HTMLElement;
  block.replaceWith(section);
  const summary = section.querySelector("[data-collapsible-summary]");
  if (summary) {
    placeCaret(summary);
  }
  notify(root);
  return true;
}

export function unsetCollapsible(root: HTMLElement): boolean {
  const section = collapsibleAt(root);
  if (!section) {
    return false;
  }
  const summary = section.querySelector(":scope > [data-collapsible-summary]");
  const body = section.querySelector(":scope > [data-collapsible-content]");
  const out: Node[] = [];
  if (summary?.textContent?.trim()) {
    const paragraph = document.createElement("p");
    paragraph.append(...summary.childNodes);
    out.push(paragraph);
  }
  out.push(...(body ? [...body.childNodes] : [emptyParagraph()]));
  section.replaceWith(...out);
  const first = out.find((node): node is Element => node.nodeType === 1);
  if (first) {
    placeCaret(first);
  }
  notify(root);
  return true;
}

export function toggleSection(section: HTMLElement): void {
  section.setAttribute("data-open", section.getAttribute("data-open") === "false" ? "true" : "false");
}

export function setAllCollapsibles(root: HTMLElement, open: boolean): void {
  let changed = false;
  for (const section of root.querySelectorAll("[data-collapsible]")) {
    const next = open ? "true" : "false";
    if (section.getAttribute("data-open") !== next) {
      section.setAttribute("data-open", next);
      changed = true;
    }
  }
  if (changed) {
    notify(root);
  }
}

// -------------------------------------------------------------------- centre

export function centerTarget(root: HTMLElement): HTMLElement | null {
  return selectedFigure(root) ?? closestIn(root, anchor(root), CENTERABLE);
}

export function toggleCenter(root: HTMLElement): boolean {
  const target = centerTarget(root);
  if (!target) {
    return false;
  }
  if (target.getAttribute("data-block-ial") === CENTER_ROW) {
    target.removeAttribute("data-block-ial");
  } else {
    target.setAttribute("data-block-ial", CENTER_ROW);
  }
  notify(root);
  return true;
}

// --------------------------------------------------------------- insert blocks

/**
 * Inserts whole blocks where the caret is, the way the old `insertBlocks` did:
 * over an empty paragraph it takes the paragraph's place, otherwise it goes
 * after the block — after a selected photo and whatever joins it (its caption,
 * the rest of its row), so neither is cut in two — and the caret moves on to a
 * paragraph after it, so the next key typed does not land on what was placed.
 */
function insertBlocks(root: HTMLElement, html: string): boolean {
  const fragment = fragmentOf(html);
  const inserted = [...fragment.children];
  const last = inserted[inserted.length - 1];
  if (!last) {
    return false;
  }
  const figure = selectedFigure(root);
  const gallery = figure?.closest("[data-gallery]");
  if (gallery && inserted.every((node) => node.hasAttribute("data-image"))) {
    gallery.querySelector(".editor-gallery-strip")?.append(fragment);
    continueAfter(gallery);
    notify(root);
    return true;
  }
  let after: Element | null = figure;
  while (after?.nextElementSibling?.hasAttribute("data-join")) {
    after = after.nextElementSibling;
  }
  const block = after ?? flowBlock(root);
  if (!block) {
    root.append(fragment);
  } else if (!after && isEmptyParagraph(block)) {
    block.replaceWith(fragment);
  } else {
    block.after(fragment);
  }
  selectFigure(root, null);
  continueAfter(last);
  notify(root);
  return true;
}

/** Stores the photos in this browser, then inserts them — as a row when there are two to four. */
export async function insertImages(
  root: HTMLElement,
  files: File[],
  stillHere: () => boolean,
): Promise<void> {
  if (!files.length) {
    return;
  }
  const stored = await Promise.all(files.map((file) => storeImageFile(file)));
  if (!stillHere()) {
    await Promise.all(stored.map((image) => imageStore.remove(image.id)));
    return;
  }
  const inGallery = Boolean(selectedFigure(root)?.closest("[data-gallery]"));
  const row = stored.length > 1 && stored.length <= ROW_LIMIT && !inGallery;
  const images: JSONContent[] = stored.map((image, index) => ({
    type: "image",
    attrs: {
      src: `${LOCAL_PREFIX}${image.id}`,
      alt: "",
      title: null,
      joinPrevious: row && index > 0,
      ial: row ? withRowClasses(null) : null,
      blockIal: row && index === stored.length - 1 ? CENTER_ROW : null,
    },
  }));
  insertBlocks(root, docToHtml({ type: "doc", content: images }));
}

export function insertEmbed(root: HTMLElement, embed: { platform: string; id: string }): boolean {
  return insertBlocks(root, docToHtml({ type: "doc", content: [{ type: "embed", attrs: embed }] }));
}

// ------------------------------------------------------------ rows, galleries

/** The photos a row or gallery would take: the selected one and the photos either side of it. */
export function imageRun(root: HTMLElement): HTMLElement[] {
  const figure = selectedFigure(root);
  if (!figure || figure.closest("[data-gallery]")) {
    return [];
  }
  const run = [figure];
  for (let node = figure.previousElementSibling; node?.hasAttribute("data-image"); node = node.previousElementSibling) {
    run.unshift(node as HTMLElement);
  }
  for (let node = figure.nextElementSibling; node?.hasAttribute("data-image"); node = node.nextElementSibling) {
    run.push(node as HTMLElement);
  }
  return run;
}

export function isRow(run: HTMLElement[]): boolean {
  return run.length > 1 && run.slice(1).every((figure) => figure.hasAttribute("data-join"));
}

function setIal(figure: HTMLElement, ial: string | null): void {
  if (ial) {
    figure.setAttribute("data-ial", ial);
  } else {
    figure.removeAttribute("data-ial");
  }
}

export function toggleImageRow(root: HTMLElement): boolean {
  const run = imageRun(root);
  if (run.length < 2) {
    return false;
  }
  const breaking = isRow(run);
  run.forEach((figure, index) => {
    figure.toggleAttribute("data-join", !breaking && index > 0);
    setIal(figure, breaking ? withoutRowClasses(figure.getAttribute("data-ial")) : withRowClasses(figure.getAttribute("data-ial")));
    if (!breaking && index === run.length - 1) {
      figure.setAttribute("data-block-ial", CENTER_ROW);
    } else if (figure.getAttribute("data-block-ial") === CENTER_ROW) {
      figure.removeAttribute("data-block-ial");
    }
  });
  notify(root);
  return true;
}

export function galleryAt(root: HTMLElement): HTMLElement | null {
  return closestIn(root, selectedFigure(root) ?? anchor(root), "[data-gallery]");
}

function plainImage(figure: HTMLElement): HTMLElement {
  for (const name of ["data-join", "data-same-line", "data-block-ial"]) {
    figure.removeAttribute(name);
  }
  setIal(figure, withoutRowClasses(figure.getAttribute("data-ial")));
  return figure;
}

export function setGallery(root: HTMLElement, kind: GalleryKind): boolean {
  const current = galleryAt(root);
  if (current) {
    current.setAttribute("data-kind", kind);
    notify(root);
    return true;
  }
  const run = imageRun(root);
  if (run.length < 2) {
    return false;
  }
  const gallery = fragmentOf(docToHtml({ type: "doc", content: [{ type: "gallery", attrs: { kind }, content: [] }] }))
    .firstElementChild as HTMLElement;
  run[0].before(gallery);
  gallery.querySelector(".editor-gallery-strip")?.append(...run.map(plainImage));
  selectFigure(root, null);
  continueAfter(gallery);
  notify(root);
  return true;
}

export function unsetGallery(root: HTMLElement): boolean {
  const gallery = galleryAt(root);
  if (!gallery) {
    return false;
  }
  const images = [...gallery.querySelectorAll<HTMLElement>("[data-image]")].map(plainImage);
  gallery.replaceWith(...images);
  selectFigure(root, null);
  const last = images[images.length - 1];
  if (last) {
    continueAfter(last);
  }
  notify(root);
  return true;
}

/** Sets a photo's alt text, or — inside a gallery — the caption its card shows. */
export function setImageText(root: HTMLElement, figure: HTMLElement, attribute: "alt" | "title", value: string): void {
  const img = figure.querySelector("img");
  if (!img) {
    return;
  }
  const text = value.trim();
  if (attribute === "alt") {
    img.setAttribute("alt", text);
  } else if (text) {
    img.setAttribute("title", text);
  } else {
    img.removeAttribute("title");
  }
  notify(root);
}

/** A photo's caption sits in the paragraph after it, marked as joining it; this finds or makes it. */
export function editCaption(root: HTMLElement, figure: HTMLElement): void {
  let last: Element = figure;
  while (last.nextElementSibling?.hasAttribute("data-join") && last.nextElementSibling.hasAttribute("data-image")) {
    last = last.nextElementSibling;
  }
  const next = last.nextElementSibling;
  if (next?.tagName === "P" && next.hasAttribute("data-join")) {
    placeCaret(next);
    return;
  }
  const caption = document.createElement("p");
  caption.setAttribute("data-join", "");
  caption.setAttribute("data-same-line", "");
  caption.append(document.createTextNode(" "));
  last.after(caption);
  selectFigure(root, null);
  placeCaret(caption);
  document.execCommand("italic");
  notify(root);
}

// ------------------------------------------------------- the browser's own

/** One of the browser's formatting commands — bold, italic, strike, superscript, subscript. */
export function format(root: HTMLElement, command: string): boolean {
  if (!selectionIn(root)) {
    root.focus();
  }
  const done = document.execCommand(command);
  notify(root);
  return done;
}

export function isFormatted(command: string): boolean {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

function formatBlock(root: HTMLElement, tag: string): void {
  document.execCommand("formatBlock", false, `<${tag}>`);
  notify(root);
}

export function headingLevel(root: HTMLElement): number | null {
  const heading = closestIn(root, anchor(root), "h1, h2, h3, h4, h5, h6");
  return heading ? Number(heading.tagName.slice(1)) : null;
}

export function toggleHeading(root: HTMLElement, level: number): void {
  formatBlock(root, headingLevel(root) === level ? "p" : `h${level}`);
}

export function inCodeBlock(root: HTMLElement): boolean {
  return Boolean(closestIn(root, anchor(root), "pre"));
}

export function toggleCodeBlock(root: HTMLElement): void {
  formatBlock(root, inCodeBlock(root) ? "p" : "pre");
}

/** Chromium's list commands leave the list inside the paragraph it was made from, which no parser keeps. */
export function liftLists(root: HTMLElement): boolean {
  let lifted = false;
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const caret = range ? { node: range.startContainer, offset: range.startOffset } : null;
  for (const list of root.querySelectorAll<HTMLElement>("p > ul, p > ol")) {
    const paragraph = list.parentElement as HTMLElement;
    const rest = [...paragraph.childNodes].filter((node) => node !== list && node.nodeName !== "BR" && node.textContent);
    if (!rest.length) {
      paragraph.replaceWith(list);
      lifted = true;
    }
  }
  if (lifted && caret && root.contains(caret.node)) {
    // Moving a node collapses any selection inside it (Ranges are live); its nodes are the same, so put the caret back.
    const restored = document.createRange();
    restored.setStart(caret.node, caret.offset);
    selection?.removeAllRanges();
    selection?.addRange(restored);
  }
  return lifted;
}

/** WebKit makes the list but leaves the caret beside it; the empty item it made is where typing belongs. */
export function keepCaretInNewItem(root: HTMLElement): void {
  if (currentTextblock(root)?.closest("li")) {
    return;
  }
  const empty = [...root.querySelectorAll("li")].filter((item) => !item.textContent?.trim());
  if (empty.length === 1) {
    placeCaret(empty[0], false);
  }
}

export type ListKind = "bullet" | "ordered" | "task";

export function listKind(root: HTMLElement): ListKind | null {
  const list = closestIn(root, anchor(root), "ul, ol");
  if (!list) {
    return null;
  }
  return list.hasAttribute("data-task-list") ? "task" : list.tagName === "OL" ? "ordered" : "bullet";
}

function untask(list: Element): void {
  list.removeAttribute("data-task-list");
  for (const item of list.querySelectorAll(":scope > li")) {
    item.removeAttribute("data-checked");
  }
}

/** The list buttons: a list of the kind asked for, or back to paragraphs when it already is one. */
export function toggleList(root: HTMLElement, kind: ListKind): void {
  const current = closestIn(root, anchor(root), "ul, ol");
  const currentKind = listKind(root);
  if (current && currentKind === "task") {
    untask(current);
  }
  if (kind === "task") {
    if (currentKind === "task") {
      notify(root);
      return;
    }
    if (!current || current.tagName === "OL") {
      document.execCommand("insertUnorderedList");
    }
  } else if (!(currentKind === "task" && kind === "bullet")) {
    document.execCommand(kind === "ordered" ? "insertOrderedList" : "insertUnorderedList");
  }
  liftLists(root);
  keepCaretInNewItem(root);
  if (kind === "task") {
    const list = closestIn(root, anchor(root), "ul, ol");
    list?.setAttribute("data-task-list", "");
    for (const item of list?.querySelectorAll(":scope > li") ?? []) {
      if (!item.hasAttribute("data-checked")) {
        item.setAttribute("data-checked", "false");
      }
    }
  }
  notify(root);
}

/** A task's box is drawn by CSS in the item's margin; a click there ticks it. */
export function toggleTask(root: HTMLElement, item: HTMLElement): void {
  item.setAttribute("data-checked", item.getAttribute("data-checked") === "true" ? "false" : "true");
  notify(root);
}

export function linkAt(root: HTMLElement): HTMLAnchorElement | null {
  return closestIn(root, anchor(root), "a[href]") as HTMLAnchorElement | null;
}

/** Links the selection, or changes the link the caret is in; an empty address removes it. */
export function setLink(root: HTMLElement, href: string): void {
  const current = linkAt(root);
  if (current) {
    const range = document.createRange();
    range.selectNodeContents(current);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }
  if (!href) {
    document.execCommand("unlink");
  } else if (current) {
    current.setAttribute("href", href);
  } else if (!selectionIn(root)?.collapsed) {
    document.execCommand("createLink", false, href);
  }
  notify(root);
}

/** A table with a header row; the caret goes to its first cell, with a paragraph under it to leave by. */
/** The link prompt, shared by the toolbar and ⌘K: the address the caret's link has, or a blank https://. */
export function askLink(root: HTMLElement): void {
  const href = window.prompt("Link URL (empty to remove)", linkAt(root)?.getAttribute("href") ?? "https://");
  if (href !== null) {
    setLink(root, href.trim());
  }
}

export function insertTable(root: HTMLElement, rows = 3, cols = 3): void {
  const row = (tag: string) => `<tr>${`<${tag}><br></${tag}>`.repeat(cols)}</tr>`;
  insertBlocks(root, `<table><tbody>${row("th")}${row("td").repeat(rows - 1)}</tbody></table>`);
  const table = closestIn(root, anchor(root), "p")?.previousElementSibling;
  const first = table?.tagName === "TABLE" ? table.querySelector("th") : null;
  if (first) {
    placeCaret(first, false);
  }
}

export function insertRule(root: HTMLElement): void {
  insertBlocks(root, "<hr>");
}
