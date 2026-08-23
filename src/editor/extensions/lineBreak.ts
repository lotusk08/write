import { Extension } from "@tiptap/core";

/**
 * Enter writes a line break; Enter twice starts a paragraph.
 *
 * The blog builds with `hard_wrap: true`, so a newline inside a paragraph is a
 * `<br>` and a blank line is a new `<p>`. A poem is the first of those and
 * prose is the second — and the only way to say the first used to be
 * Shift+Enter, which a phone keyboard does not have. So every line of a poem
 * written here became its own paragraph: a `>` gap between each one in the
 * quote, and an attribution sitting several gaps below what it belonged to.
 *
 * Enter is the line break now. The paragraph is still there — press it again on
 * a line you have not written on yet and the break turns into one, which is the
 * blank line the blog reads as a new `<p>`.
 *
 * Only where a paragraph flows: a list item, a table cell and a section summary
 * have their own idea of what Enter means, and keep it.
 */
const FLOWING = new Set(["doc", "blockquote"]);

export const EnterBreaks = Extension.create({
  name: "enterBreaks",

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== "paragraph") {
          return false;
        }
        if (!FLOWING.has($from.node(-1)?.type.name ?? "")) {
          return false;
        }
        // An empty paragraph has nothing to break; let Enter do what it does
        // there, which is leave the quote it is in.
        if ($from.parent.content.size === 0) {
          return false;
        }

        // A second Enter, on the empty line the first one made: take the break
        // back out and end the paragraph instead.
        const before = $from.nodeBefore;
        if (before?.type.name === "hardBreak") {
          return editor
            .chain()
            .deleteRange({ from: $from.pos - before.nodeSize, to: $from.pos })
            .splitBlock()
            .run();
        }

        return editor.commands.setHardBreak();
      },
    };
  },
});
