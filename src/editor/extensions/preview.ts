import { Node, mergeAttributes, textblockTypeInputRule } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";
import { renderChart, renderMath, renderMermaid, type Teardown } from "../render.ts";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mathBlock: {
      /** Turns the block under the cursor into a `$$ … $$` display equation. */
      setMathBlock: () => ReturnType;
    };
  }
}

/** Code fences the blog hands to a library instead of printing verbatim. */
const RENDERED = new Set(["mermaid", "chart"]);

/** Long enough that a preview is not rebuilt on every keystroke. */
const REDRAW_MS = 400;

function isDark(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

/**
 * Builds the shell a previewed block lives in: the rendered output above, the
 * source below, and the plumbing that keeps them in step.
 */
function previewView(
  paint: (source: string, node: ProseMirrorNode, target: HTMLElement) => Promise<Teardown> | null,
  className: string,
) {
  return ({ node }: { node: ProseMirrorNode }): NodeView => {
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
      const started = paint(current.textContent, current, preview);
      if (!started) {
        teardown?.();
        teardown = null;
        dom.dataset.preview = "off";
        preview.innerHTML = "";
        return;
      }
      dom.dataset.preview = "on";
      void started.then((next) => {
        // A later edit has already been drawn; drop this one's output.
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
      // The preview is ours to paint; ProseMirror should not read it back.
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

/**
 * The blog's ` ```mermaid ` and ` ```chart ` fences, drawn as you type. Any
 * other language is left as a plain code block.
 */
export const PreviewCodeBlock = CodeBlock.extend({
  addNodeView() {
    return previewView((source, node, target) => {
      const language = String(node.attrs.language ?? "");
      if (!RENDERED.has(language) || !source.trim()) {
        return null;
      }
      return language === "mermaid"
        ? renderMermaid(source, target, isDark(), `mermaid-${Math.abs(hash(source))}`)
        : renderChart(source, target, isDark());
    }, "code-block");
  },
});

/** Stable enough to keep Mermaid's generated ids from colliding. */
function hash(value: string): number {
  let out = 0;
  for (let i = 0; i < value.length; i++) {
    out = (out * 31 + value.charCodeAt(i)) | 0;
  }
  return out;
}

/**
 * A block this editor has no node for — raw HTML (an embed, mostly) or a
 * Kramdown description list. Held verbatim and written back untouched, and
 * shown as source rather than rendered, so a post cannot run anything inside
 * the editor.
 */
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

/**
 * A display equation, written as TeX and typeset underneath. Serialises to the
 * `$$ … $$` block MathJax picks up on the blog.
 */
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
      // Same escape hatch the code block gives you: Enter on a blank last line.
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
