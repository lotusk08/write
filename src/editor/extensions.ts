import Highlight from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import Typography from "@tiptap/extension-typography";
import StarterKit from "@tiptap/starter-kit";
import { BlockAttributes, FilepathCode } from "./extensions/blogFormat.ts";
import { collapsibleExtensions } from "./extensions/collapsible.ts";
import { Embed } from "./extensions/embed.ts";
import { footnoteExtensions } from "./extensions/footnote.ts";
import { EnterBreaks } from "./extensions/lineBreak.ts";
import { MathBlock, PreviewCodeBlock, RawBlock } from "./extensions/preview.ts";
import { NoteQuote } from "./extensions/noteQuote.ts";
import { LocalImage } from "./extensions/localImage.ts";

export const buildEditorExtensions = (options: { collab?: boolean } = {}) => [
  StarterKit.configure({
    link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    heading: { levels: [1, 2, 3, 4] },
    codeBlock: false,
    code: false,
    blockquote: false,
    ...(options.collab ? { undoRedo: false as const } : {}),
  }),
  PreviewCodeBlock.configure({ languageClassPrefix: "language-" }),
  MathBlock,
  RawBlock,
  Embed,
  FilepathCode,
  BlockAttributes,
  EnterBreaks,
  NoteQuote,
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: true } }),
  Highlight,
  Superscript.extend({ excludes: "subscript" }),
  Subscript.extend({ excludes: "superscript" }),
  Typography.configure({ laquo: false, raquo: false }),
  LocalImage.configure({ inline: false, allowBase64: true }),
  ...collapsibleExtensions,
  ...footnoteExtensions,
  Placeholder.configure({
    includeChildren: true,
    placeholder: ({ editor, node }) => {
      if (node.type.name === "collapsibleSummary") {
        return "Section title";
      }
      if (node.type.name === "heading") {
        return "Heading";
      }
      if (node.type.name === "paragraph" && node.attrs.joinPrevious) {
        return "Caption";
      }
      return editor.isEmpty
        ? "Write in Markdown"
        : "";
    },
  }),
];

export const editorExtensions = buildEditorExtensions();

export const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };
