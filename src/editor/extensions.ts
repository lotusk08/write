import Highlight from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import Typography from "@tiptap/extension-typography";
import StarterKit from "@tiptap/starter-kit";
import { BlockAttributes, FilepathCode } from "./extensions/blogFormat.ts";
import { collapsibleExtensions } from "./extensions/collapsible.ts";
import { Embed } from "./extensions/embed.ts";
import { MathBlock, PreviewCodeBlock, RawBlock } from "./extensions/preview.ts";
import { NoteQuote } from "./extensions/noteQuote.ts";
import { LocalImage } from "./extensions/localImage.ts";

/** The editor's whole feature set, in one place. */
export const editorExtensions = [
  StarterKit.configure({
    link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    heading: { levels: [1, 2, 3, 4] },
    // Replaced by PreviewCodeBlock, which draws mermaid and chart fences.
    codeBlock: false,
    // Replaced by FilepathCode, which adds the blog's `.filepath` variant.
    code: false,
    // Replaced by NoteQuote, which adds the blog's callout styles.
    blockquote: false,
  }),
  PreviewCodeBlock.configure({ languageClassPrefix: "language-" }),
  MathBlock,
  RawBlock,
  Embed,
  FilepathCode,
  BlockAttributes,
  NoteQuote,
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: true } }),
  Highlight,
  // `laquo`/`raquo` would turn the `>>>` collapsible shortcut into «».
  Typography.configure({ laquo: false, raquo: false }),
  LocalImage.configure({ inline: false, allowBase64: true }),
  ...collapsibleExtensions,
  Placeholder.configure({
    includeChildren: true,
    placeholder: ({ node }) => {
      if (node.type.name === "collapsibleSummary") {
        return "Section title";
      }
      if (node.type.name === "heading") {
        return "Heading";
      }
      return "Write. Markdown shortcuts work: # heading, - list, > quote, ``` code, >>> collapsible section.";
    },
  }),
];

export const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };
