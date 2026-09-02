import { Node, mergeAttributes, textblockTypeInputRule } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";
import { renderChart, renderMath, renderMermaid, type Teardown } from "../render.ts";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mathBlock: {
      setMathBlock: () => ReturnType;
    };
  }
}

const RENDERED = new Set(["mermaid", "chart"]);

const REDRAW_MS = 400;

let previews = 0;

function isDark(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

function previewView(
  paint: (
    source: string,
    node: ProseMirrorNode,
    target: HTMLElement,
    key: string,
  ) => Promise<Teardown> | null,
  className: string,
) {
  return ({ node }: { node: ProseMirrorNode }): NodeView => {
    const serial = ++previews;
    const dom = document.createElement("div");
    dom.className = className;

    const preview = document.createElement("div");
    preview.className = "block-preview";
    preview.contentEditable = "false";

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    pre.append(code);
    dom.append(preview, pre);

    let teardown: Teardown | null = null;
    let timer: number | undefined;
    let generation = 0;

    const draw = (current: ProseMirrorNode) => {
      const mine = ++generation;
      const started = paint(current.textContent, current, preview, `${serial}-${mine}`);
      if (!started) {
        teardown?.();
        teardown = null;
        dom.dataset.preview = "off";
        preview.innerHTML = "";
        return;
      }
      dom.dataset.preview = "on";
      void started.then((next) => {
        if (mine !== generation) {
          next();
          return;
        }
        teardown?.();
        teardown = next;
      });
    };

    const schedule = (current: ProseMirrorNode) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => draw(current), REDRAW_MS);
    };

    draw(node);

    return {
      dom,
      contentDOM: code,
      update(updated) {
        if (updated.type !== node.type) {
          return false;
        }
        schedule(updated);
        return true;
      },
      ignoreMutation: (mutation) => preview.contains(mutation.target as globalThis.Node),
      stopEvent: (event) => preview.contains(event.target as globalThis.Node),
      destroy() {
        window.clearTimeout(timer);
        generation += 1;
        teardown?.();
      },
    };
  };
}

export const PreviewCodeBlock = CodeBlock.extend({
  addNodeView() {
    return previewView((source, node, target, key) => {
      const language = String(node.attrs.language ?? "");
      if (!RENDERED.has(language) || !source.trim()) {
        return null;
      }
      return language === "mermaid"
        ? renderMermaid(source, target, isDark(), `mermaid-${key}`)
        : renderChart(source, target, isDark());
    }, "code-block");
  },
});

export const RawBlock = Node.create({
  name: "rawBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-raw]", preserveWhitespace: "full" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-raw": "", class: "raw-block" }), 0];
  },
});

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-math]", preserveWhitespace: "full" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-math": "" }), 0];
  },

  addCommands() {
    return {
      setMathBlock:
        () =>
        ({ commands }) =>
          commands.setNode(this.name),
    };
  },

  addInputRules() {
    return [textblockTypeInputRule({ find: /^\$\$\s$/, type: this.type })];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-m": () => this.editor.commands.setMathBlock(),
    };
  },

  addNodeView() {
    return previewView(
      (source, _node, target) => (source.trim() ? renderMath(source, target) : null),
      "math-block",
    );
  },
});
