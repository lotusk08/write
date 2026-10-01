import { Extension, type JSONContent } from "@tiptap/core";
import type { ResolvedPos } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type Transaction } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    insertBlocks: {
      insertBlocks: (content: JSONContent | JSONContent[]) => ReturnType;
      insertTableBlock: (options: { rows: number; cols: number; withHeaderRow: boolean }) => ReturnType;
    };
  }
}

function paragraphRoom(tr: Transaction, pos: number): ResolvedPos {
  const paragraph = tr.doc.type.schema.nodes.paragraph;
  let $pos = tr.doc.resolve(pos);
  while ($pos.depth > 0 && !$pos.parent.canReplaceWith($pos.index(), $pos.index(), paragraph)) {
    $pos = tr.doc.resolve($pos.after());
  }
  return $pos;
}

function ensureParagraph(tr: Transaction, pos: number): number {
  const $pos = paragraphRoom(tr, pos);
  if ($pos.nodeAfter?.type.name !== "paragraph") {
    tr.insert($pos.pos, tr.doc.type.schema.nodes.paragraph.create());
  }
  return $pos.pos + 1;
}

export function continueAfter(tr: Transaction, pos: number): Transaction {
  const cursor = ensureParagraph(tr, pos);
  return tr.setSelection(TextSelection.create(tr.doc, cursor));
}

function insertionEnd(tr: Transaction, steps: number): number | null {
  if (tr.steps.length <= steps) {
    return null;
  }
  let end: number | null = null;
  tr.mapping.maps[tr.steps.length - 1].forEach((_from, _to, _newFrom, newTo) => {
    end ??= newTo;
  });
  return end;
}

function afterSelectedNode(selection: NodeSelection, first: string | undefined): number {
  if (selection.node.type.name === "gallery" && first === "image") {
    return selection.to - 1;
  }
  const { doc } = selection.$to;
  let pos = selection.to;
  let next = doc.resolve(pos).nodeAfter;
  while (next?.attrs.joinPrevious) {
    pos += next.nodeSize;
    next = doc.resolve(pos).nodeAfter;
  }
  return pos;
}

export const InsertBlocks = Extension.create({
  name: "insertBlocks",

  addCommands() {
    return {
      insertBlocks:
        (content) =>
        ({ state, tr, dispatch, commands }) => {
          const list = Array.isArray(content) ? content : [content];
          const first = list[0]?.type;
          const type = first ? state.schema.nodes[first] : undefined;
          if (!type) {
            return false;
          }
          const { selection } = state;
          const steps = tr.steps.length;
          let inserted: boolean;
          if (selection instanceof NodeSelection) {
            let $at = state.doc.resolve(afterSelectedNode(selection, first));
            while ($at.depth > 0 && !$at.parent.canReplaceWith($at.index(), $at.index(), type)) {
              $at = state.doc.resolve($at.after());
            }
            inserted = commands.insertContentAt($at.pos, list);
          } else {
            inserted = commands.insertContent(list);
          }
          if (!inserted || !dispatch) {
            return inserted;
          }
          const end = insertionEnd(tr, steps);
          if (end !== null) {
            continueAfter(tr, end);
          }
          return true;
        },

      insertTableBlock:
        (options) =>
        ({ tr, dispatch, commands }) => {
          if (!commands.insertTable(options)) {
            return false;
          }
          if (!dispatch) {
            return true;
          }
          const { $from } = tr.selection;
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.name === "table") {
              const cursor = tr.selection.from;
              ensureParagraph(tr, $from.after(depth));
              tr.setSelection(TextSelection.create(tr.doc, cursor));
              break;
            }
          }
          return true;
        },
    };
  },
});
