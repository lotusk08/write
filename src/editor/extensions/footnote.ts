import { Node, mergeAttributes } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: {
      insertFootnote: () => ReturnType;
    };
  }
}

export const FootnoteRef = Node.create({
  name: "footnoteRef",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      label: {
        default: "1",
        parseHTML: (element) => element.getAttribute("data-footnote-ref"),
        renderHTML: (attributes) => ({ "data-footnote-ref": attributes.label as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "sup[data-footnote-ref]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes, { class: "footnote-ref" }), String(node.attrs.label)];
  },

  addCommands() {
    return {
      insertFootnote:
        () =>
        ({ state, tr, dispatch }) => {
          const { schema, selection } = state;
          const { $from } = selection;
          if (!$from.parent.isTextblock) {
            return false;
          }
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.name === "footnoteDef") {
              return false;
            }
          }
          const definition = schema.nodes.footnoteDef;
          const paragraph = schema.nodes.paragraph;
          if (!definition || !paragraph) {
            return false;
          }
          const used = new Set<string>();
          state.doc.descendants((node) => {
            if (node.type.name === this.name || node.type.name === definition.name) {
              used.add(String(node.attrs.label));
            }
          });
          let number = 1;
          while (used.has(String(number))) {
            number += 1;
          }
          if (!dispatch) {
            return true;
          }
          const label = String(number);
          tr.replaceSelectionWith(this.type.create({ label }), false);
          const end = tr.doc.content.size;
          tr.insert(end, definition.create({ label }, paragraph.create()));
          tr.setSelection(TextSelection.near(tr.doc.resolve(end + 2)));
          dispatch(tr.scrollIntoView());
          return true;
        },
    };
  },
});

export const FootnoteDef = Node.create({
  name: "footnoteDef",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      label: {
        default: "1",
        parseHTML: (element) => element.getAttribute("data-footnote"),
        renderHTML: (attributes) => ({ "data-footnote": attributes.label as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-footnote]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "footnote" }), 0];
  },
});

export const footnoteExtensions = [FootnoteRef, FootnoteDef];
