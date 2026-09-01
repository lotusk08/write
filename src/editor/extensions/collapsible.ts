import { InputRule, Node, mergeAttributes } from "@tiptap/core";
import type { NodeView } from "@tiptap/pm/view";
import { TextSelection } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    collapsible: {
      setCollapsible: () => ReturnType;
      unsetCollapsible: () => ReturnType;
      setAllCollapsiblesOpen: (open: boolean) => ReturnType;
    };
  }
}

export const CollapsibleSummary = Node.create({
  name: "collapsibleSummary",
  content: "inline*",
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: "summary" }, { tag: "div[data-collapsible-summary]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-collapsible-summary": "",
        class: "collapsible-summary",
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state, view } = this.editor;
        const { $from } = state.selection;
        if ($from.parent.type.name !== this.name) {
          return false;
        }
        const summaryEnd = $from.end();
        const bodyStart = summaryEnd + 2;
        if (bodyStart > state.doc.content.size) {
          return false;
        }
        view.dispatch(
          state.tr.setSelection(TextSelection.near(state.doc.resolve(bodyStart))).scrollIntoView(),
        );
        return true;
      },
      Backspace: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.name !== this.name || $from.parentOffset !== 0) {
          return false;
        }
        return this.editor.commands.unsetCollapsible();
      },
    };
  },
});

export const CollapsibleContent = Node.create({
  name: "collapsibleContent",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-collapsible-content]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-collapsible-content": "",
        class: "collapsible-content",
      }),
      0,
    ];
  },
});

export const Collapsible = Node.create({
  name: "collapsible",
  group: "block",
  content: "collapsibleSummary collapsibleContent",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => element.getAttribute("data-open") !== "false",
        renderHTML: (attributes) => ({ "data-open": attributes.open ? "true" : "false" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-collapsible]" }, { tag: "details" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-collapsible": "", class: "collapsible" }), 0];
  },

  addNodeView() {
    return ({ node, editor, getPos }): NodeView => {
      const dom = document.createElement("div");
      dom.className = "collapsible";
      dom.dataset.collapsible = "";

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "collapsible-toggle";
      toggle.contentEditable = "false";
      toggle.setAttribute("aria-label", "Toggle section");

      const body = document.createElement("div");
      body.className = "collapsible-body";

      dom.append(toggle, body);

      const paint = (open: boolean) => {
        dom.dataset.open = open ? "true" : "false";
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.textContent = open ? "▾" : "▸";
      };
      paint(Boolean(node.attrs.open));

      toggle.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const pos = getPos();
        if (typeof pos !== "number") {
          return;
        }
        const current = editor.state.doc.nodeAt(pos);
        if (!current) {
          return;
        }
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...current.attrs,
            open: !current.attrs.open,
          }),
        );
      });

      return {
        dom,
        contentDOM: body,
        update: (updated) => {
          if (updated.type.name !== "collapsible") {
            return false;
          }
          paint(Boolean(updated.attrs.open));
          return true;
        },
        stopEvent: (event) => event.target === toggle,
        ignoreMutation: (mutation) =>
          mutation.target === toggle || (mutation.type === "attributes" && mutation.target === dom),
      };
    };
  },

  addCommands() {
    return {
      setCollapsible:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;
          if (!$from.parent.isTextblock) {
            return false;
          }
          const { schema } = state;
          const summaryType = schema.nodes.collapsibleSummary;
          const contentType = schema.nodes.collapsibleContent;
          if (!summaryType || !contentType) {
            return false;
          }

          const text = $from.parent.textContent.trim();
          const node = schema.nodes[this.name].createChecked({ open: true }, [
            summaryType.createChecked(null, text ? schema.text(text) : null),
            contentType.createChecked(null, schema.nodes.paragraph.createChecked()),
          ]);

          if (!dispatch) {
            return true;
          }
          const from = $from.before($from.depth);
          tr.replaceRangeWith(from, $from.after($from.depth), node);
          tr.setSelection(TextSelection.near(tr.doc.resolve(from + 2 + text.length)));
          dispatch(tr.scrollIntoView());
          return true;
        },

      unsetCollapsible:
        () =>
        ({ state, chain }) => {
          const { $from } = state.selection;
          for (let depth = $from.depth; depth > 0; depth--) {
            if ($from.node(depth).type.name === this.name) {
              const node = $from.node(depth);
              const from = $from.before(depth);
              const to = from + node.nodeSize;
              const summary = node.firstChild;
              const body = node.lastChild;
              const content = [
                ...(summary && summary.content.size
                  ? [{ type: "paragraph", content: summary.content.toJSON() as object[] }]
                  : []),
                ...((body?.content.toJSON() as object[] | null) ?? [{ type: "paragraph" }]),
              ];
              return chain().insertContentAt({ from, to }, content).run();
            }
          }
          return false;
        },

      setAllCollapsiblesOpen:
        (open: boolean) =>
        ({ state, dispatch }) => {
          const { tr } = state;
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs.open !== open) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, open });
              changed = true;
            }
          });
          if (changed && dispatch) {
            dispatch(tr.setMeta("addToHistory", false));
          }
          return changed;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-D": () => this.editor.commands.setCollapsible(),
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^(>>>|:::)\s$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).setCollapsible().run();
        },
      }),
    ];
  },
});

export const collapsibleExtensions = [Collapsible, CollapsibleSummary, CollapsibleContent];
