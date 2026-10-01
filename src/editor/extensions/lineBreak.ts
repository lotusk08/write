import { Extension, type Editor } from "@tiptap/core";
import { Selection, type EditorState } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { continueAfter } from "./insertBlocks.ts";

const FLOWING = new Set(["doc", "blockquote", "collapsibleContent"]);

const CELLS = new Set(["tableCell", "tableHeader"]);

const FENCE_OPENER = /^(?:`{3,}|~{3,})([^`]*)$/;

function cellBelow(state: EditorState): { cell: number | null; table: number } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 2; depth -= 1) {
    if (CELLS.has($from.node(depth).type.name)) {
      const table = $from.node(depth - 2);
      const start = $from.start(depth - 2);
      const map = TableMap.get(table);
      const rect = map.findCell($from.before(depth) - start);
      return {
        cell: rect.bottom < map.height ? start + map.map[rect.bottom * map.width + rect.left] : null,
        table: $from.after(depth - 2),
      };
    }
  }
  return null;
}

function enterInCell(editor: Editor): boolean {
  const below = cellBelow(editor.state);
  if (!below) {
    return false;
  }
  const { doc, tr } = editor.state;
  if (below.cell === null) {
    editor.view.dispatch(continueAfter(tr, below.table).scrollIntoView());
    return true;
  }
  const end = below.cell + (doc.nodeAt(below.cell)?.nodeSize ?? 2) - 1;
  editor.view.dispatch(tr.setSelection(Selection.near(doc.resolve(end), -1)).scrollIntoView());
  return true;
}

function openFence(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  const { parent } = $from;
  const line = parent.lastChild;
  const before = parent.childCount > 1 ? parent.child(parent.childCount - 2) : null;
  if (!line?.isText || $from.parentOffset !== parent.content.size || (before && before.type.name !== "hardBreak")) {
    return false;
  }
  const fence = FENCE_OPENER.exec(line.text ?? "");
  if (!fence) {
    return false;
  }
  const start = $from.pos - line.nodeSize;
  const chain = editor.chain();
  if (before) {
    chain.deleteRange({ from: start - before.nodeSize, to: $from.pos }).splitBlock();
  } else {
    chain.deleteRange({ from: start, to: $from.pos });
  }
  return chain.setNode("codeBlock", { language: fence[1].trim() || null }).run();
}

export const EnterBreaks = Extension.create({
  name: "enterBreaks",

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        if (enterInCell(editor)) {
          return true;
        }
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
        if (openFence(editor)) {
          return true;
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
      "Shift-Enter": ({ editor }) => cellBelow(editor.state) !== null,
      "Mod-Enter": ({ editor }) => cellBelow(editor.state) !== null,
    };
  },
});
