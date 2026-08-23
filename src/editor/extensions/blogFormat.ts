import { Extension } from "@tiptap/core";
import Code from "@tiptap/extension-code";
import type { Node } from "@tiptap/pm/model";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockAttributes: {
      /** Sets the Kramdown attribute list on the block under the cursor. */
      setBlockAttributes: (value: string | null) => ReturnType;
      /** Sets it, or clears it when the block already carries that value. */
      toggleBlockAttributes: (value: string) => ReturnType;
      /** Lays neighbouring images out as one row, or breaks the row up. */
      toggleImageRow: () => ReturnType;
    };
  }
}

/** The blog's centred image row, the one block attribute worth a button. */
export const CENTER_ROW = "{: .d-flex .c-center }";

/**
 * What the blog's own posts put on each photo in a row. `.gap` is a quarter of
 * a rem of margin in the site's stylesheet, so the spacing between photos is
 * the site's to decide rather than something this editor invents; `.normal`
 * keeps the width class off them. Written per image, not per row, which is how
 * the posts that already do this are written.
 */
const ROW_CLASSES = ["normal", "gap"];

const IAL_BODY = /^\{:\s*|\s*\}$/g;
const rowClass = (name: string) => new RegExp(`\\.${name}(?![\\w-])`);

/** Adds the row classes, keeping whatever the list already carries. */
export function withRowClasses(ial: unknown): string {
  const body = String(ial ?? "").replace(IAL_BODY, "").trim();
  const missing = ROW_CLASSES.filter((name) => !rowClass(name).test(body));
  return `{: ${[body, ...missing.map((name) => `.${name}`)].filter(Boolean).join(" ")} }`;
}

/** Takes them out again, and the list with them when nothing else is left. */
export function withoutRowClasses(ial: unknown): string | null {
  const body = String(ial ?? "")
    .replace(IAL_BODY, "")
    .replace(new RegExp(`\\.(?:${ROW_CLASSES.join("|")})(?![\\w-])`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
  return body ? `{: ${body} }` : null;
}

/** Whether the images around the cursor are already laid out as one row. */
export function inImageRow(state: EditorState): boolean {
  return isRow(imageRun(state));
}

/** Whether there are neighbouring images to make a row out of at all. */
export function canImageRow(state: EditorState): boolean {
  return imageRun(state).length > 1;
}

/**
 * Blocks that can carry a Kramdown attribute list of their own — the
 * `{: .d-flex .c-center }`, `{: file='…' }` and `{: data-toc-skip='' }` lines
 * the blog's posts are written with. Held verbatim so a post survives a trip
 * through the editor unchanged, whether or not this app understands the
 * classes inside.
 */
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
];

interface RowImage {
  pos: number;
  node: Node;
}

/**
 * The run of neighbouring images the selection is in.
 *
 * A selection covering more than one image is taken as written; a cursor
 * resting on a single one reaches out to the images either side of it, so
 * three stacked photos become a row from a tap on any of them — the only kind
 * of aim there is on a phone.
 */
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
    return touched;
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

/** Images written on adjacent lines: one paragraph, and one row on the blog. */
function isRow(run: RowImage[]): boolean {
  return run.length > 1 && run.slice(1).every((image) => Boolean(image.node.attrs.joinPrevious));
}

export const BlockAttributes = Extension.create({
  name: "blockAttributes",

  addGlobalAttributes() {
    return [
      {
        // Markdown carries column alignment in the divider row.
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
            parseHTML: (element) => element.getAttribute("data-block-ial"),
            renderHTML: (attributes) =>
              attributes.blockIal ? { "data-block-ial": attributes.blockIal as string } : {},
          },
          /**
           * Set on a block that shared a paragraph with the one before it —
           * an image and its caption, or a row of images. The blog styles
           * those as one paragraph, so they are written back as one.
           */
          joinPrevious: {
            default: false,
            parseHTML: (element) => element.hasAttribute("data-join"),
            renderHTML: (attributes) => (attributes.joinPrevious ? { "data-join": "" } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    /** The nearest enclosing block that takes an attribute list. */
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

      /**
       * A row is one paragraph of images to Kramdown — the lines written
       * against each other — carrying the flex class the blog lays them out
       * with. That class goes on the last of them, which is the line the
       * attribute list is written under.
       */
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

/**
 * Inline code with the blog's `{: .filepath}` variant, which it renders as a
 * path rather than as a code span.
 */
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
