import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";
import { imageRun, withoutRowClasses } from "./blogFormat.ts";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    gallery: {
      setGallery: (kind: GalleryKind) => ReturnType;
      unsetGallery: () => ReturnType;
    };
  }
}

export const GALLERY_KINDS = ["deck", "fan", "peek", "fold"] as const;
export type GalleryKind = (typeof GALLERY_KINDS)[number];

export const GALLERY_LABELS: Record<GalleryKind, string> = {
  deck: "Deck",
  fan: "Fan",
  peek: "Peek",
  fold: "Fold",
};

export function isGalleryKind(value: unknown): value is GalleryKind {
  return (GALLERY_KINDS as readonly unknown[]).includes(value);
}

export interface GalleryAt {
  pos: number;
  node: ProseMirrorNode;
}

export function galleryAt(state: EditorState): GalleryAt | null {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.node.type.name === "gallery") {
    return { pos: selection.from, node: selection.node };
  }
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "gallery") {
      return { pos: $from.before(depth), node };
    }
  }
  return null;
}

export function canGallery(state: EditorState): boolean {
  return Boolean(galleryAt(state)) || imageRun(state).length > 1;
}

function plainImage(node: ProseMirrorNode) {
  return node.type.create(
    {
      ...node.attrs,
      joinPrevious: false,
      sameLine: false,
      blockIal: null,
      ial: withoutRowClasses(node.attrs.ial),
    },
    null,
    node.marks,
  );
}

export const Gallery = Node.create({
  name: "gallery",
  group: "block",
  content: "image+",
  defining: true,
  isolating: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      kind: {
        default: "deck",
        parseHTML: (element) => {
          const kind = element.getAttribute("data-kind");
          return isGalleryKind(kind) ? kind : "deck";
        },
        renderHTML: (attributes) => ({ "data-kind": attributes.kind as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "figure[data-gallery]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["figure", mergeAttributes(HTMLAttributes, { "data-gallery": "", class: "editor-gallery" }), 0];
  },

  addCommands() {
    return {
      setGallery:
        (kind) =>
        ({ state, tr, dispatch }) => {
          const current = galleryAt(state);
          if (current) {
            dispatch?.(tr.setNodeAttribute(current.pos, "kind", kind));
            return true;
          }
          const run = imageRun(state);
          if (run.length < 2) {
            return false;
          }
          const first = run[0];
          const last = run[run.length - 1];
          const gallery = this.type.create({ kind }, run.map(({ node }) => plainImage(node)));
          if (dispatch) {
            tr.replaceWith(first.pos, last.pos + last.node.nodeSize, gallery);
            tr.setSelection(NodeSelection.create(tr.doc, first.pos));
            dispatch(tr);
          }
          return true;
        },

      unsetGallery:
        () =>
        ({ state, tr, dispatch }) => {
          const current = galleryAt(state);
          if (!current) {
            return false;
          }
          if (dispatch) {
            const images: ProseMirrorNode[] = [];
            current.node.forEach((child) => images.push(plainImage(child)));
            tr.replaceWith(current.pos, current.pos + current.node.nodeSize, images);
            tr.setSelection(TextSelection.near(tr.doc.resolve(current.pos)));
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addNodeView() {
    return ({ node }): NodeView => {
      const dom = document.createElement("figure");
      dom.className = "editor-gallery";

      const label = document.createElement("span");
      label.className = "editor-gallery-label";
      label.contentEditable = "false";

      const strip = document.createElement("div");
      strip.className = "editor-gallery-strip";

      const paint = (current: ProseMirrorNode) => {
        const kind = String(current.attrs.kind ?? "deck");
        dom.dataset.kind = kind;
        label.textContent = `Gallery · ${isGalleryKind(kind) ? GALLERY_LABELS[kind] : kind}`;
      };
      paint(node);
      dom.append(label, strip);

      return {
        dom,
        contentDOM: strip,
        update: (updated) => {
          if (updated.type !== node.type) {
            return false;
          }
          paint(updated);
          return true;
        },
        selectNode: () => dom.classList.add("is-selected"),
        deselectNode: () => dom.classList.remove("is-selected"),
        ignoreMutation: (mutation) => label.contains(mutation.target as globalThis.Node),
      };
    };
  },
});
