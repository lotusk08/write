import { CENTER_ROW, isGalleryKind, isNoteType, type GalleryKind, type NoteType } from "./blog.ts";
import {
  centerTarget,
  collapsibleAt,
  galleryAt,
  headingLevel,
  imageRun,
  inCodeBlock,
  isFormatted,
  isRow,
  linkAt,
  listKind,
  quoteAt,
  selectionIn,
  type ListKind,
} from "./commands.ts";

/** What the toolbar and the bubble light up for where the caret is. */
export interface ToolState {
  heading: number | null;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  superscript: boolean;
  subscript: boolean;
  highlight: boolean;
  code: boolean;
  filepath: boolean;
  link: boolean;
  list: ListKind | null;
  quote: boolean;
  note: NoteType | null;
  codeBlock: boolean;
  collapsible: boolean;
  centered: boolean;
  imageRow: boolean;
  canImageRow: boolean;
  gallery: GalleryKind | null;
  canGallery: boolean;
}

export function emptyTools(): ToolState {
  return {
    heading: null,
    bold: false,
    italic: false,
    strike: false,
    superscript: false,
    subscript: false,
    highlight: false,
    code: false,
    filepath: false,
    link: false,
    list: null,
    quote: false,
    note: null,
    codeBlock: false,
    collapsible: false,
    centered: false,
    imageRow: false,
    canImageRow: false,
    gallery: null,
    canGallery: false,
  };
}

export function readTools(root: HTMLElement): ToolState {
  const range = selectionIn(root);
  const at = range
    ? range.startContainer.nodeType === 1
      ? (range.startContainer as Element)
      : range.startContainer.parentElement
    : null;
  const inside = (selector: string) => {
    const found = at?.closest(selector);
    return Boolean(found && found !== root && root.contains(found));
  };
  const quote = quoteAt(root);
  const gallery = galleryAt(root);
  const run = imageRun(root);
  const kind = gallery?.getAttribute("data-kind");
  const note = quote?.getAttribute("data-note");
  const typing = Boolean(range);
  return {
    heading: headingLevel(root),
    bold: typing && isFormatted("bold"),
    italic: typing && isFormatted("italic"),
    strike: typing && isFormatted("strikeThrough"),
    superscript: typing && isFormatted("superscript"),
    subscript: typing && isFormatted("subscript"),
    highlight: inside("mark"),
    code: inside("code") && !inside("pre"),
    filepath: inside("code.filepath"),
    link: Boolean(linkAt(root)),
    list: listKind(root),
    quote: Boolean(quote),
    note: isNoteType(note) ? note : null,
    codeBlock: inCodeBlock(root),
    collapsible: Boolean(collapsibleAt(root)),
    centered: centerTarget(root)?.getAttribute("data-block-ial") === CENTER_ROW,
    imageRow: isRow(run),
    canImageRow: run.length > 1,
    gallery: isGalleryKind(kind) ? kind : null,
    canGallery: Boolean(gallery) || run.length > 1,
  };
}
