import { Extension } from "@tiptap/core";
import Code from "@tiptap/extension-code";
import type { Node } from "@tiptap/pm/model";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockAttributes: {
      setBlockAttributes: (value: string | null) => ReturnType;
      toggleBlockAttributes: (value: string) => ReturnType;
      toggleImageRow: () => ReturnType;
    };
  }
}

export const CENTER_ROW = "{: .d-flex .c-center }";

const ROW_CLASSES = ["normal", "gap"];

const IAL_BODY = /^\{:\s*|\s*\}$/g;
const rowClass = (name: string) => new RegExp(`\\.${name}(?![\\w-])`);

export function withRowClasses(ial: unknown): string {
  const body = String(ial ?? "").replace(IAL_BODY, "").trim();
  const missing = ROW_CLASSES.filter((name) => !rowClass(name).test(body));
  return `{: ${[body, ...missing.map((name) => `.${name}`)].filter(Boolean).join(" ")} }`;
}

export function withoutRowClasses(ial: unknown): string | null {
  const body = String(ial ?? "")
    .replace(IAL_BODY, "")
    .replace(new RegExp(`\\.(?:${ROW_CLASSES.join("|")})(?![\\w-])`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
  return body ? `{: ${body} }` : null;
}

export function inImageRow(state: EditorState): boolean {
  return isRow(imageRun(state));
}

export function canImageRow(state: EditorState): boolean {
  return imageRun(state).length > 1;
}

const BLOCKS = [
  "paragraph",
  "heading",
  "image",
  "blockquote",
  "codeBlock",
  "bulletList",
  "orderedList",
  "taskList",
  "table",
  "mathBlock",
  "rawBlock",
  "embed",
  "horizontalRule",
  "collapsible",
  "footnoteDef",
];

interface RowImage {
  pos: number;
  node: Node;
}

function imageRun(state: EditorState): RowImage[] {
  const { from, to } = state.selection;
  const touched: RowImage[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "image") {
      touched.push({ pos, node });
      return false;
    }
    return true;
  });
  if (!touched.length) {
    return [];
  }
  if (touched.length > 1) {
    const $first = state.doc.resolve(touched[0].pos);
    const contiguous = touched.every(({ pos }, offset) => {
      const $pos = state.doc.resolve(pos);
      return $pos.parent === $first.parent && $pos.index() === $first.index() + offset;
    });
    return contiguous ? touched : [];
  }

  const $image = state.doc.resolve(touched[0].pos);
  const parent = $image.parent;
  const index = $image.index();
  let first = index;
  let last = index;
  while (first > 0 && parent.child(first - 1).type.name === "image") {
    first -= 1;
  }
  while (last + 1 < parent.childCount && parent.child(last + 1).type.name === "image") {
    last += 1;
  }

  const run: RowImage[] = [];
  let pos = $image.start();
  for (let i = 0; i <= last; i += 1) {
    if (i >= first) {
      run.push({ pos, node: parent.child(i) });
    }
    pos += parent.child(i).nodeSize;
  }
  return run;
}

function isRow(run: RowImage[]): boolean {
  return run.length > 1 && run.slice(1).every((image) => Boolean(image.node.attrs.joinPrevious));
}

export const BlockAttributes = Extension.create({
  name: "blockAttributes",

  addGlobalAttributes() {
    return [
      {
        types: ["tableHeader", "tableCell"],
        attributes: {
          align: {
            default: null,
            parseHTML: (element) => element.style.textAlign || null,
            renderHTML: (attributes) =>
              attributes.align ? { style: `text-align: ${attributes.align as string}` } : {},
          },
        },
      },
      {
        types: BLOCKS,
        attributes: {
          blockIal: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute("data-block-ial"),
            renderHTML: (attributes) =>
              attributes.blockIal ? { "data-block-ial": attributes.blockIal as string } : {},
          },
          ialAbove: {
            default: false,
            keepOnSplit: false,
            parseHTML: (element) => element.hasAttribute("data-ial-above"),
            renderHTML: (attributes) => (attributes.ialAbove ? { "data-ial-above": "" } : {}),
          },
          joinPrevious: {
            default: false,
            keepOnSplit: false,
            parseHTML: (element) => element.hasAttribute("data-join"),
            renderHTML: (attributes) => (attributes.joinPrevious ? { "data-join": "" } : {}),
          },
          sameLine: {
            default: false,
            keepOnSplit: false,
            parseHTML: (element) => element.hasAttribute("data-same-line"),
            renderHTML: (attributes) => (attributes.sameLine ? { "data-same-line": "" } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    const target = (selection: NodeSelection | { $from: { depth: number } }) => {
      if (selection instanceof NodeSelection && selection.node.type.spec.attrs?.blockIal) {
        return selection.from;
      }
      const { $from } = selection as { $from: NodeSelection["$from"] };
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.spec.attrs?.blockIal) {
          return $from.before(depth);
        }
      }
      return null;
    };

    return {
      setBlockAttributes:
        (value) =>
        ({ state, tr, dispatch }) => {
          const at = target(state.selection as NodeSelection);
          if (at === null) {
            return false;
          }
          dispatch?.(tr.setNodeAttribute(at, "blockIal", value));
          return true;
        },

      toggleBlockAttributes:
        (value) =>
        ({ state, tr, dispatch }) => {
          const at = target(state.selection as NodeSelection);
          if (at === null) {
            return false;
          }
          const current = state.doc.nodeAt(at)?.attrs.blockIal;
          dispatch?.(tr.setNodeAttribute(at, "blockIal", current === value ? null : value));
          return true;
        },

      toggleImageRow:
        () =>
        ({ state, tr, dispatch }) => {
          const run = imageRun(state);
          if (run.length < 2) {
            return false;
          }
          const breaking = isRow(run);
          run.forEach(({ pos, node }, index) => {
            tr.setNodeAttribute(pos, "joinPrevious", breaking ? false : index > 0);
            tr.setNodeAttribute(
              pos,
              "ial",
              breaking ? withoutRowClasses(node.attrs.ial) : withRowClasses(node.attrs.ial),
            );
            const last = index === run.length - 1;
            if (!breaking && last) {
              tr.setNodeAttribute(pos, "blockIal", CENTER_ROW);
            } else if (node.attrs.blockIal === CENTER_ROW) {
              tr.setNodeAttribute(pos, "blockIal", null);
            }
          });
          dispatch?.(tr);
          return true;
        },
    };
  },
});

export const FilepathCode = Code.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      filepath: {
        default: false,
        parseHTML: (element) => element.classList.contains("filepath"),
        renderHTML: (attributes) => (attributes.filepath ? { class: "filepath" } : {}),
      },
    };
  },
});
