import type { EditorInit } from "@erag/text-editor-vue";

/**
 * The editor sanitizes every value it is handed and every paste, keeping only
 * the tags and attributes listed here. Everything `bridge.ts` writes has to be
 * on this list, or the first pass through the editor strips it — the way an
 * undeclared Tiptap attribute used to vanish.
 */
const BLOCK_DATA = ["data-block-ial", "data-ial-above", "data-join", "data-same-line", "data-lazy"];

const allowedTags = [
  "p", "br", "div", "span", "strong", "b", "em", "i", "u", "ins", "s", "strike", "del", "mark",
  "sup", "sub", "code", "pre", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
  "a", "img", "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "hr",
];

const allowedAttributes: Record<string, string[]> = {
  "*": ["class", "style", "title", "dir", ...BLOCK_DATA, "data-within"],
  a: ["href"],
  blockquote: ["data-note"],
  pre: ["data-language", "data-raw"],
  ul: ["data-task-list"],
  ol: ["start"],
  li: ["data-checked"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
  figure: ["data-image", "data-ial", "data-gallery", "data-kind", "contenteditable"],
  img: ["src", "alt", "data-src", "data-local-src"],
  div: [
    "contenteditable",
    "data-embed",
    "data-platform",
    "data-id",
    "data-collapsible",
    "data-open",
    "data-collapsible-summary",
    "data-collapsible-content",
    "data-footnote",
    "data-raw",
  ],
  sup: ["data-footnote-ref", "contenteditable"],
  span: ["data-raw-inline", "data-mark"],
};

export const sanitizerOptions = {
  allowedTags,
  allowedAttributes,
  allowRelativeUrls: true,
};

/** The editor is the writing surface alone: the app draws its own toolbar, bubble and menus. */
export const editorInit: EditorInit = {
  height: "auto",
  minHeight: 0,
  menubar: false,
  toolbar: false,
  statusbar: false,
  resize: false,
  branding: false,
  promotion: false,
  placeholder: "Write in Markdown",
  spellcheck: true,
  contentClass: "post-body",
  plugins: ["history", "formatting", "lists", "link", "table"],
  imageResize: false,
  imageFilePicker: false,
  pasteImages: false,
  automaticUploads: false,
  sanitize: true,
  allowedTags,
  allowedAttributes,
  relativeUrls: true,
  convertUrls: false,
};
