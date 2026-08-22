import Blockquote from "@tiptap/extension-blockquote";

/** The callout classes the blog's stylesheet defines for blockquotes. */
export const NOTE_TYPES = ["tip", "info", "important", "warning", "danger"] as const;

export type NoteType = (typeof NOTE_TYPES)[number];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    noteQuote: {
      /** Turns the selection into a callout, or back into a plain quote. */
      setBlockquoteNote: (note: NoteType | null) => ReturnType;
    };
  }
}

/**
 * A blockquote that can carry one of the blog's note styles. It exports as the
 * Kramdown attribute the site expects:
 *
 *     > Only works if you prepare before the trip.
 *     {: .note-info }
 */
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
