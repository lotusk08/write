import { Extension } from "@tiptap/core";

const FLOWING = new Set(["doc", "blockquote", "collapsibleContent"]);

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
        if ($from.parent.content.size === 0) {
          return false;
        }
        if ($from.parentOffset === 0) {
          return false;
        }

        const before = $from.nodeBefore;
        if (before?.type.name === "hardBreak") {
          return editor
            .chain()
            .deleteRange({ from: $from.pos - before.nodeSize, to: $from.pos })
            .splitBlock({ keepMarks: !$from.parent.attrs.joinPrevious })
            .run();
        }

        return editor.commands.setHardBreak();
      },
    };
  },
});
