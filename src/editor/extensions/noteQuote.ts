import Blockquote from "@tiptap/extension-blockquote";

export const NOTE_TYPES = ["tip", "info", "important", "warning", "danger", "author"] as const;

export type NoteType = (typeof NOTE_TYPES)[number];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    noteQuote: {
      setBlockquoteNote: (note: NoteType | null) => ReturnType;
    };
  }
}

export const NoteQuote = Blockquote.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      note: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-note"),
        renderHTML: (attributes) =>
          attributes.note ? { "data-note": attributes.note as string } : {},
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setBlockquoteNote:
        (note: NoteType | null) =>
        ({ chain, editor }) => {
          const chained = editor.isActive(this.name) ? chain() : chain().setBlockquote();
          return chained.updateAttributes(this.name, { note }).focus().run();
        },
    };
  },
});
