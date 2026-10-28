import { imageStore, LOCAL_PREFIX, storeImageFile } from "../lib/db.ts";
import type { NoteType } from "./blog.ts";
import { docToHtml } from "./bridge.ts";
import type { JSONContent } from "./doc.ts";

/**
 * The blog's own blocks, edited straight on the editor's DOM. The editor
 * (text-editor-vue) keeps its content as HTML and offers the common formatting
 * itself; what it has no command for — callouts, sections, galleries,
 * footnotes, players — is done here, in the same HTML `bridge.ts`
 * reads back. Every command ends with `notify`, which is how the editor learns
 * its content changed under it.
 */

const TEXTBLOCK = "p, h1, h2, h3, h4, h5, h6, pre, li, td, th, [data-collapsible-summary]";

/** Containers whose children are blocks laid one under another, as the document's own are. */
const FLOW = "blockquote, [data-collapsible-content], [data-footnote], li, td, th";

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

/** Puts the caret in the paragraph after `node`, making one when none follows (or, `fresh`, unless the one there is empty). */
export function continueAfter(node: Element, fresh = false): void {
  let next = node.nextElementSibling;
  if (next?.tagName !== "P" || (fresh && !isEmptyParagraph(next))) {
    next = emptyParagraph();
    node.after(next);
  }
  placeCaret(next, false);
}

// ------------------------------------------------------------- selected photo

export function selectFigure(root: HTMLElement, figure: HTMLElement | null): void {
  const previous = selectedFigures.get(root);
  previous?.classList.remove("is-selected");
  previous?.removeAttribute("tabindex");
  if (figure) {
    figure.classList.add("is-selected");
    selectedFigures.set(root, figure);
    figure.tabIndex = -1;
  } else {
    selectedFigures.delete(root);
  }
}

export function selectedFigure(root: HTMLElement): HTMLElement | null {
  const figure = selectedFigures.get(root) ?? null;
  return figure && root.contains(figure) ? figure : null;
}

// --------------------------------------------------------------------- inline

/** The word around a collapsed caret, so a mark pressed with nothing selected takes the word, as in Docs. */
function wordAround(range: Range, word = /[\p{L}\p{N}_'’-]/u): Range | null {
  const node = range.startContainer;
  if (node.nodeType !== 3) {
    return null;
  }
  const text = (node as Text).data;
  let start = range.startOffset;
  let end = start;
  while (start > 0 && word.test(text[start - 1])) {
    start -= 1;
  }
  while (end < text.length && word.test(text[end])) {
    end += 1;
  }
  if (start === end) {
    return null;
  }
  const around = document.createRange();
  around.setStart(node, start);
  around.setEnd(node, end);
  return around;
}

/** The innermost text blocks a range crosses, each with the part of the range inside it. */
function blockRanges(root: HTMLElement, range: Range): Range[] {
  const blocks = [...root.querySelectorAll<HTMLElement>(TEXTBLOCK)].filter(
    (block) => range.intersectsNode(block) && !block.querySelector(TEXTBLOCK) && !block.closest("pre, figure, [data-transient]"),
  );
  return blocks.flatMap((block) => {
    const part = document.createRange();
    part.selectNodeContents(block);
    if (block.contains(range.startContainer)) {
      part.setStart(range.startContainer, range.startOffset);
    }
    if (block.contains(range.endContainer)) {
      part.setEnd(range.endContainer, range.endOffset);
    }
    return part.toString() ? [part] : [];
  });
}

/** Takes `mark` off the part of it inside `range`, leaving it on the rest. */
function liftPart(mark: HTMLElement, range: Range): void {
  const before = document.createRange();
  before.setStart(mark, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.setStart(range.endContainer, range.endOffset);
  after.setEnd(mark, mark.childNodes.length);
  for (const [part, place] of [
    [before, "before"],
    [after, "after"],
  ] as const) {
    if (mark.contains(part.startContainer) && mark.contains(part.endContainer) && part.toString()) {
      const piece = mark.cloneNode(false) as HTMLElement;
      piece.append(part.extractContents());
      mark[place](piece);
    }
  }
  unwrap(mark);
}

/** Wraps the selection in `tag` — the word at a bare caret, every block a selection crosses — or lifts it where it is set. */
export function toggleInline(root: HTMLElement, tag: string): boolean {
  const selected = selectionIn(root);
  const range = selected?.collapsed ? wordAround(selected) ?? selected : selected;
  if (!range) {
    return false;
  }
  const existing = closestIn(root, elementOf(range.startContainer), tag);
  const whole = document.createRange();
  if (existing) {
    whole.selectNode(existing);
  }
  if (existing && range.compareBoundaryPoints(Range.END_TO_END, whole) <= 0) {
    if (range.collapsed || range.toString() === existing.textContent) {
      unwrap(existing);
    } else {
      const inside = range.cloneRange();
      if (!existing.contains(inside.endContainer)) {
        inside.setEnd(existing, existing.childNodes.length);
      }
      liftPart(existing, inside);
    }
    notify(root);
    return true;
  }
  const parts = range.collapsed ? [] : blockRanges(root, range);
  if (!parts.length) {
    return false;
  }
  const made = parts.map((part) => {
    const element = document.createElement(tag);
    element.append(part.extractContents());
    element.querySelectorAll(tag).forEach(unwrap);
    part.insertNode(element);
    return element;
  });
  const marked = document.createRange();
  marked.setStartBefore(made[0]);
  marked.setEndAfter(made[made.length - 1]);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(marked);
  notify(root);
  return true;
}

/** The blog's `{: .path}` code: plain code gains the class, a file path loses its code, and plain text becomes a file path, a bare caret taking the whole path round it. */
export function toggleFilepath(root: HTMLElement): boolean {
  const range = selectionIn(root);
  const code = closestIn(root, anchor(root), "code") ?? (range && codeCovering(root, range));
  if (code && !code.closest("pre")) {
    if (code.classList.contains("filepath")) {
      unwrap(code);
    } else {
      code.classList.add("filepath");
    }
    notify(root);
    return true;
  }
  const path = range?.collapsed ? wordAround(range, /\S/u) : null;
  if (path) {
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(path);
  }
  if (!toggleInline(root, "code")) {
    return false;
  }
  const made = selectionIn(root);
  for (const element of root.querySelectorAll("code")) {
    if (made?.intersectsNode(element) && !element.closest("pre")) {
      element.classList.add("filepath");
    }
  }
  notify(root);
  return true;
}

/** The inline code a selection is exactly, as it is once one has been made: the selection then runs round it, not inside it. */
function codeCovering(root: HTMLElement, range: Range): HTMLElement | null {
  if (range.collapsed) {
    return null;
  }
  const covered = [...root.querySelectorAll<HTMLElement>("code")].filter((code) => range.intersectsNode(code));
  return covered.length === 1 && covered[0].textContent === range.toString() ? covered[0] : null;
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
  range.collapse(false);
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

/** A callout of the blog's: `{: .tip }` and the rest, `{: .author }` or `{: .poem }`. Picking the current kind takes it off. */
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

// --------------------------------------------------------------- insert blocks

/** Where blocks go in: after the selected photo, or at the block the caret is in. */
interface Place {
  figure: HTMLElement | null;
  block: HTMLElement | null;
}

function placeOf(root: HTMLElement): Place {
  const figure = selectedFigure(root);
  return { figure, block: figure ? null : flowBlock(root) };
}

/**
 * Inserts whole blocks where the caret is, the way the old `insertBlocks` did:
 * over an empty paragraph it takes the paragraph's place, otherwise it goes
 * after the block — after a selected photo and whatever joins it (its caption,
 * the rest of its row), so neither is cut in two — and the caret moves on to a
 * paragraph after it, so the next key typed does not land on what was placed.
 * Given a `place` taken earlier, the blocks go there; `follow` false leaves the
 * caret and the selected photo where the writer has since put them.
 */
function insertBlocks(root: HTMLElement, html: string, place: Place = placeOf(root), follow = true): boolean {
  const fragment = fragmentOf(html);
  const inserted = [...fragment.children];
  const last = inserted[inserted.length - 1];
  if (!last) {
    return false;
  }
  const figure = place.figure && root.contains(place.figure) ? place.figure : null;
  const gallery = figure?.closest("[data-gallery]");
  if (figure && gallery && inserted.every((node) => node.hasAttribute("data-image"))) {
    figure.after(fragment);
    if (follow) {
      continueAfter(gallery);
      selectFigure(root, last as HTMLElement);
    }
    notify(root);
    return true;
  }
  // Anything but photos pasted on a gallery's photo goes after the gallery, never into its strip.
  let after: Element | null = gallery ?? figure;
  while (after?.nextElementSibling?.hasAttribute("data-join")) {
    after = after.nextElementSibling;
  }
  const block = after ?? (place.block && root.contains(place.block) ? place.block : flowBlock(root));
  const caretIn = Boolean(block?.contains(selectionIn(root)?.startContainer ?? null));
  if (!block) {
    root.append(fragment);
  } else if (!after && isEmptyParagraph(block) && (follow || !caretIn)) {
    block.replaceWith(fragment);
  } else {
    block.after(fragment);
  }
  if (follow) {
    selectFigure(root, null);
    continueAfter(last);
  }
  notify(root);
  return true;
}

function caretSpot(root: HTMLElement): [Node, number] | null {
  const range = selectionIn(root);
  return range ? [range.startContainer, range.startOffset] : null;
}

/**
 * Stores the photos in this browser, then inserts them — several at once as a gallery, the blog's only way to show
 * photos together. They go where they were added; a writer who typed or moved the caret while they were being stored
 * keeps the caret, where it used to jump to below the photos mid-word.
 */
export async function insertImages(
  root: HTMLElement,
  files: File[],
  stillHere: () => boolean,
  spot: DropSpot | null = null,
): Promise<void> {
  if (!files.length) {
    return;
  }
  const place = placeOf(root);
  const spotAt = caretSpot(root);
  let edited = false;
  const onInput = () => (edited = true);
  root.addEventListener("input", onInput);
  let stored: Awaited<ReturnType<typeof storeImageFile>>[];
  try {
    stored = await Promise.all(files.map((file) => storeImageFile(file)));
  } finally {
    root.removeEventListener("input", onInput);
  }
  if (!stillHere()) {
    await Promise.all(stored.map((image) => imageStore.remove(image.id)));
    window.alert("Not added: the draft changed while the photo was being stored. Add it again.");
    return;
  }
  const now = caretSpot(root);
  const still = !edited && now?.[0] === spotAt?.[0] && now?.[1] === spotAt?.[1];
  const images: JSONContent[] = stored.map((image) => ({
    type: "image",
    attrs: { src: `${LOCAL_PREFIX}${image.id}`, alt: "", title: null },
  }));
  if (spot && root.contains(spot.ref)) {
    const html = docToHtml({ type: "doc", content: spot.kind === "photo" || images.length < 2 ? images : [{ type: "gallery", content: images }] });
    putAt(root, [...fragmentOf(html).children] as HTMLElement[], spot);
    return;
  }
  const inGallery = Boolean(place.figure?.closest("[data-gallery]"));
  const content = images.length > 1 && !inGallery ? [{ type: "gallery", content: images }] : images;
  insertBlocks(root, docToHtml({ type: "doc", content }), place, still);
}

/** Pastes blocks copied in the editor — photos, galleries, players — where the caret or the selected photo is. */
export function insertDoc(root: HTMLElement, doc: JSONContent): boolean {
  const range = selectionIn(root);
  if (range && !range.collapsed && !selectedFigure(root)) {
    range.deleteContents();
  }
  return insertBlocks(root, docToHtml(doc));
}

export function insertEmbed(root: HTMLElement, embed: { platform: string; id: string }): boolean {
  return insertBlocks(root, docToHtml({ type: "doc", content: [{ type: "embed", attrs: embed }] }));
}

// ------------------------------------------------------------------ galleries

/** The photos a gallery would take: the selected one and the photos either side of it. */
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

export function galleryAt(root: HTMLElement): HTMLElement | null {
  return closestIn(root, selectedFigure(root) ?? anchor(root), "[data-gallery]");
}

function plainImage(figure: HTMLElement): HTMLElement {
  for (const name of ["data-join", "data-same-line", "data-block-ial"]) {
    figure.removeAttribute(name);
  }
  return figure;
}

export function setGallery(root: HTMLElement): boolean {
  const run = imageRun(root);
  if (run.length < 2) {
    return false;
  }
  const gallery = newGallery();
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

/** Puts the caret in the paragraph after the selected photo's gallery, so typing goes on there. */
export function leaveGallery(root: HTMLElement): boolean {
  const gallery = selectedFigure(root)?.closest("[data-gallery]");
  if (!gallery) {
    return false;
  }
  selectFigure(root, null);
  root.focus({ preventScroll: true });
  continueAfter(gallery, true);
  notify(root);
  return true;
}

/** Moves the selected gallery photo one place back (-1) or on (1). */
export function moveGalleryPhoto(root: HTMLElement, step: -1 | 1): boolean {
  const figure = selectedFigure(root);
  const other = step < 0 ? figure?.previousElementSibling : figure?.nextElementSibling;
  if (!figure?.closest("[data-gallery]") || !other?.hasAttribute("data-image")) {
    return false;
  }
  other[step < 0 ? "before" : "after"](figure);
  figure.focus({ preventScroll: true });
  figure.scrollIntoView({ block: "nearest", inline: "nearest" });
  notify(root);
  return true;
}

/** Takes the selected photo out of its gallery; a gallery left with one photo or none is no gallery. */
export function removeGalleryPhoto(root: HTMLElement): boolean {
  const figure = selectedFigure(root);
  const gallery = figure?.closest<HTMLElement>("[data-gallery]");
  if (!figure || !gallery) {
    return false;
  }
  const next = (figure.nextElementSibling ?? figure.previousElementSibling) as HTMLElement | null;
  figure.remove();
  const place = settleGallery(gallery);
  if (!place && next) {
    selectFigure(root, next);
    next.focus({ preventScroll: true });
  } else if (place) {
    selectFigure(root, null);
    if (place.matches("[data-image]")) {
      continueAfter(place);
    } else {
      placeCaret(place);
    }
  }
  notify(root);
  return true;
}

// ------------------------------------------------------------- drag and drop

/** Where a dragged photo or block lands: beside a photo (one alone becomes a gallery), or above or below a block. */
export interface DropSpot {
  kind: "photo" | "block";
  ref: HTMLElement;
  side: "before" | "after";
}

function newGallery(): HTMLElement {
  return fragmentOf(docToHtml({ type: "doc", content: [{ type: "gallery", content: [] }] })).firstElementChild as HTMLElement;
}

/** The italic caption line joined under a photo, from drafts written before captions were titles; none, null. */
export function captionOf(figure: HTMLElement): Element | null {
  const next = figure.nextElementSibling;
  return next?.matches("p[data-join]") ? next : null;
}

/** An italic caption line left behind by its photo stands on its own. */
export function freeCaption(figure: HTMLElement): void {
  const caption = captionOf(figure);
  caption?.removeAttribute("data-join");
  caption?.removeAttribute("data-same-line");
}

/** The gallery a photo is in; a photo alone is put in a new one, for another to join it. */
function galleryOf(figure: HTMLElement): HTMLElement {
  const found = figure.closest<HTMLElement>("[data-gallery]");
  if (found) {
    return found;
  }
  const gallery = newGallery();
  freeCaption(figure);
  figure.before(gallery);
  gallery.querySelector(".editor-gallery-strip")?.append(plainImage(figure));
  return gallery;
}

/** A gallery left with one photo is a plain image, and one left with none an empty paragraph; returns what took its place. */
function settleGallery(gallery: HTMLElement | null): HTMLElement | null {
  if (!gallery?.isConnected) {
    return null;
  }
  const left = [...gallery.querySelectorAll<HTMLElement>("[data-image]")];
  if (left.length > 1) {
    return null;
  }
  const place = left[0] ? plainImage(left[0]) : emptyParagraph();
  gallery.replaceWith(place);
  return place;
}

/** Puts photos beside a photo, in its gallery, a photo alone becoming a gallery of them both. */
function besidePhoto(spot: DropSpot, photos: HTMLElement[]): void {
  galleryOf(spot.ref);
  spot.ref[spot.side](...photos.map(plainImage));
}

/** Leaves a paragraph to type in after a block that would otherwise end the post. */
function roomAfter(root: HTMLElement, node: Element): void {
  const top = node.closest("[data-gallery]") ?? node;
  if (top.parentElement === root && !top.nextElementSibling) {
    top.after(emptyParagraph());
  }
}

/** Puts new blocks at a drop spot, photos beside a photo going into its gallery, and selects the last photo placed. */
function putAt(root: HTMLElement, nodes: HTMLElement[], spot: DropSpot): void {
  const last = nodes[nodes.length - 1];
  if (!last) {
    return;
  }
  if (spot.kind === "photo") {
    besidePhoto(spot, nodes);
  } else {
    spot.ref[spot.side](...nodes);
  }
  roomAfter(root, last);
  selectFigure(root, last.matches("[data-image]") ? last : null);
  notify(root);
}

/**
 * Moves a photo or a whole gallery to a drop spot: a photo between two others of a gallery, into another gallery or
 * beside a photo alone, which makes a gallery of the two, or out between blocks of the post. The gallery it left is
 * settled, as removing a photo does.
 */
export function moveBlock(root: HTMLElement, dragged: HTMLElement, spot: DropSpot): boolean {
  const photo = dragged.matches("[data-image]");
  if (spot.ref === dragged || dragged.contains(spot.ref) || (spot.kind === "photo" && !photo) || !root.contains(dragged)) {
    return false;
  }
  const from = photo ? dragged.closest<HTMLElement>("[data-gallery]") : null;
  const caption = photo && !from ? captionOf(dragged) : null;
  if (spot.ref === caption) {
    return false;
  }
  if (spot.kind === "photo") {
    freeCaption(dragged);
    besidePhoto(spot, [dragged]);
  } else if (from || !photo) {
    spot.ref[spot.side](photo ? plainImage(dragged) : dragged);
  } else {
    // A photo alone keeps what is written on it and takes its caption line along; it only leaves the row it was in.
    dragged.removeAttribute("data-join");
    spot.ref[spot.side](...(caption ? [dragged, caption] : [dragged]));
  }
  settleGallery(from);
  roomAfter(root, dragged);
  selectFigure(root, photo ? dragged : null);
  if (photo) {
    dragged.focus({ preventScroll: true });
  }
  notify(root);
  return true;
}

/** Sets a photo's alt text, which describes it and names its file; it is never the caption. */
export function setImageAlt(root: HTMLElement, figure: HTMLElement, value: string): void {
  const img = figure.querySelector("img");
  if (!img) {
    return;
  }
  img.setAttribute("alt", value.trim());
  notify(root);
}

/** Sets a photo's caption, its title — `![alt](src "caption")` — which the blog draws under it. */
export function setImageCaption(root: HTMLElement, figure: HTMLElement, value: string): void {
  const img = figure.querySelector("img");
  if (!img) {
    return;
  }
  const caption = value.trim();
  if (caption) {
    img.setAttribute("title", caption);
  } else {
    img.removeAttribute("title");
  }
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

/** A code block back to text is one paragraph, a line break per line, as Enter writes; `formatBlock` left a paragraph inside the `<pre>`. */
export function toggleCodeBlock(root: HTMLElement): void {
  const pre = closestIn(root, anchor(root), "pre");
  if (!pre) {
    formatBlock(root, "pre");
    return;
  }
  const copy = pre.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  const paragraph = document.createElement("p");
  copy.textContent?.replace(/\n$/, "").split("\n").forEach((line, index) => {
    paragraph.append(...(index ? [document.createElement("br")] : []), line);
  });
  paragraph.append(document.createElement("br"));
  pre.replaceWith(paragraph);
  placeCaret(paragraph);
  notify(root);
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

/** The selected items of `list` back to paragraphs, the list split around them. */
function unlist(list: HTMLElement, range: Range): void {
  const items = [...list.children].filter((item) => item.tagName === "LI");
  const picked = items.filter((item) => range.intersectsNode(item));
  const first = items.indexOf(picked[0] ?? items[0]);
  const last = items.indexOf(picked[picked.length - 1] ?? items[0]);
  const after = list.cloneNode(false) as HTMLElement;
  after.append(...items.slice(last + 1));
  const blocks = items.slice(first, last + 1).flatMap((item) => {
    const nested = [...item.children].some((child) => /^(P|UL|OL|BLOCKQUOTE|PRE|TABLE|H[1-6])$/.test(child.tagName));
    if (nested) {
      return [...item.childNodes].filter((node) => node.nodeType === 1 || node.textContent?.trim());
    }
    const paragraph = document.createElement("p");
    paragraph.append(...item.childNodes);
    if (!paragraph.lastChild || paragraph.lastChild.nodeName !== "BR") {
      paragraph.append(document.createElement("br"));
    }
    return [paragraph];
  });
  items.slice(first, last + 1).forEach((item) => item.remove());
  if (after.children.length && list.children.length) {
    // The list's attribute list goes with the part it is written next to: above the first, or under the last.
    const bare = list.hasAttribute("data-ial-above") ? after : list;
    bare.removeAttribute("data-block-ial");
    bare.removeAttribute("data-ial-above");
  }
  list.after(...blocks, ...(after.children.length ? [after] : []));
  if (!list.children.length) {
    list.remove();
  }
  const caret = blocks.find((node): node is Element => node.nodeType === 1);
  if (caret) {
    placeCaret(caret);
  }
}

/** One list as another kind, every item kept: the browser's commands converted only the item the caret was in. */
function relist(list: HTMLElement, kind: ListKind): HTMLElement {
  const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
  const caret = range && list.contains(range.startContainer) ? { node: range.startContainer, offset: range.startOffset } : null;
  const next = document.createElement(kind === "ordered" ? "ol" : "ul");
  for (const name of list.getAttributeNames().filter((name) => name !== "data-task-list" && name !== "start")) {
    next.setAttribute(name, list.getAttribute(name) ?? "");
  }
  next.append(...list.childNodes);
  list.replaceWith(next);
  if (caret) {
    const restored = document.createRange();
    restored.setStart(caret.node, caret.offset);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(restored);
  }
  if (kind === "task") {
    next.setAttribute("data-task-list", "");
    for (const item of next.querySelectorAll(":scope > li:not([data-checked])")) {
      item.setAttribute("data-checked", "false");
    }
  } else {
    untask(next);
  }
  return next;
}

/** Chromium's list commands rebuild the line's text and put the caret at its start, so a typed line made a list and Enter then split it before its first word; the caret goes back as far into the line as it was. */
function keepingOffset(root: HTMLElement, run: () => void): void {
  const range = selectionIn(root);
  const block = currentTextblock(root);
  const line = range?.collapsed && block ? lineAround(block, range) : null;
  run();
  const item = closestIn(root, anchor(root), "li");
  if (!line || !item || item.textContent !== line.before + line.after) {
    return;
  }
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
  let left = line.before.length;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.nodeValue?.length ?? 0;
    if (left <= length) {
      window.getSelection()?.collapse(node, left);
      return;
    }
    left -= length;
  }
}

/** The text of the caret's line, either side of it: a block's lines are parted by `<br>`, and the list commands make each its own item. */
function lineAround(block: HTMLElement, range: Range): { before: string; after: string } {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let before = "";
  let after = "";
  let past = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeName === "BR") {
      if (past) {
        break;
      }
      before = "";
    } else if (node.nodeType === 3) {
      const value = node.nodeValue ?? "";
      if (node === range.startContainer) {
        before += value.slice(0, range.startOffset);
        after += value.slice(range.startOffset);
        past = true;
      } else if (past || range.comparePoint(node, 0) >= 0) {
        after += value;
        past = true;
      } else {
        before += value;
      }
    }
  }
  return { before, after };
}

/** The list buttons: a list of the kind asked for, or back to paragraphs when it already is one. */
export function toggleList(root: HTMLElement, kind: ListKind): void {
  const range = selectionIn(root);
  const current = closestIn(root, anchor(root), "ul, ol");
  if (current && range && listKind(root) === kind) {
    unlist(current, range);
  } else if (current) {
    relist(current, kind);
  } else {
    keepingOffset(root, () => document.execCommand(kind === "ordered" ? "insertOrderedList" : "insertUnorderedList"));
    liftLists(root);
    keepCaretInNewItem(root);
    const list = closestIn(root, anchor(root), "ul, ol");
    if (kind === "task" && list) {
      relist(list, "task");
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
function setLink(root: HTMLElement, href: string): void {
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
  } else if (selectionIn(root)) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = href;
    document.execCommand("insertHTML", false, link.outerHTML);
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
