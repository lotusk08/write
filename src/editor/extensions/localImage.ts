import Image from "@tiptap/extension-image";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { ReplaceAroundStep, ReplaceStep } from "@tiptap/pm/transform";
import type { NodeView } from "@tiptap/pm/view";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { LOCAL_PREFIX, imageStore, isLocalSrc, resolveLocalSrc, storeImageFile } from "../../lib/db.ts";
import { displaySrc } from "../../lib/site.ts";
import { CENTER_ROW, withRowClasses } from "./blogFormat.ts";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    localImage: {
      insertLocalImages: (files: File[]) => ReturnType;
    };
  }
}

const ROW_LIMIT = 4;

const epochKey = new PluginKey<number>("localImageEpoch");

function swapsDocument(tr: Transaction, previous: EditorState): boolean {
  if (tr.getMeta(ySyncPluginKey)) {
    return false;
  }
  const size = previous.doc.content.size;
  return tr.steps.some(
    (step) =>
      (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) &&
      step.from === 0 &&
      step.to === size,
  );
}

function imageFilesFrom(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) {
    return [];
  }
  const files: File[] = [];
  for (const entry of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = "getAsFile" in entry ? entry.getAsFile() : entry;
    if (file && file.type.startsWith("image/")) {
      files.push(file);
    }
  }
  return files;
}

const WIDTH_CLASSES: Record<string, string> = {
  "w-25": "25%",
  "w-50": "50%",
  "w-75": "75%",
  normal: "100%",
};

function parseIal(ial: string): { classes: string[]; attrs: Record<string, string> } {
  const classes: string[] = [];
  const attrs: Record<string, string> = {};
  const token = /\.([\w-]+)|([\w-]+)=(["'])((?:(?!\3).)*)\3|([\w-]+)=(\S+)/g;
  for (const match of ial.matchAll(token)) {
    if (match[1]) {
      classes.push(match[1]);
    } else if (match[2]) {
      attrs[match[2]] = match[4];
    } else if (match[5]) {
      attrs[match[5]] = match[6];
    }
  }
  return { classes, attrs };
}

function applyLayout(figure: HTMLElement, image: HTMLImageElement, ial: string): void {
  const { classes, attrs } = parseIal(ial);
  const fraction = classes.find((name) => name in WIDTH_CLASSES);
  const width = Number(attrs.width ?? attrs.w);
  const height = Number(attrs.height ?? attrs.h);

  figure.style.width = fraction ? WIDTH_CLASSES[fraction] : "";
  image.style.aspectRatio = width && height ? `${width} / ${height}` : "";
  figure.style.float = classes.includes("left")
    ? "left"
    : classes.includes("right")
      ? "right"
      : "";
  figure.classList.toggle("is-shadowed", classes.includes("shadow"));
  figure.classList.toggle("is-gapped", classes.includes("gap"));
  figure.classList.toggle("is-rounded", classes.some((name) => name.startsWith("rounded")));
  figure.dataset.scheme = classes.includes("light")
    ? "light"
    : classes.includes("dark")
      ? "dark"
      : "";
}

export const LocalImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
      ial: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-ial"),
        renderHTML: (attributes) => (attributes.ial ? { "data-ial": attributes.ial as string } : {}),
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      insertLocalImages:
        (files: File[]) =>
        ({ editor }) => {
          if (!files.length) {
            return false;
          }
          const epoch = epochKey.getState(editor.state) ?? 0;
          void Promise.all(files.map((file) => storeImageFile(file)))
            .then((stored) => {
              if (editor.isDestroyed || (epochKey.getState(editor.state) ?? 0) !== epoch) {
                void Promise.all(stored.map((image) => imageStore.remove(image.id)));
                return;
              }
              const row = stored.length > 1 && stored.length <= ROW_LIMIT;
              editor
                .chain()
                .focus()
                .insertContent(
                  stored.map((image, index) => ({
                    type: this.name,
                    attrs: {
                      src: `${LOCAL_PREFIX}${image.id}`,
                      alt: "",
                      title: null,
                      joinPrevious: row && index > 0,
                      ial: row ? withRowClasses(null) : null,
                      blockIal: row && index === stored.length - 1 ? CENTER_ROW : null,
                    },
                  })),
                )
                .run();
            })
            .catch((error: unknown) => {
              window.alert(
                `Could not store the image${files.length === 1 ? "" : "s"}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            });
          return true;
        },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }): NodeView => {
      const figure = document.createElement("figure");
      figure.className = "editor-image";

      const img = document.createElement("img");
      img.alt = String(node.attrs.alt ?? "");
      img.draggable = false;

      const tools = document.createElement("div");
      tools.className = "editor-image-tools";
      tools.contentEditable = "false";

      const alt = document.createElement("button");
      alt.type = "button";
      alt.className = "editor-image-alt";

      const caption = document.createElement("button");
      caption.type = "button";
      caption.className = "editor-image-alt editor-image-caption";
      caption.textContent = "Add caption";

      let generation = 0;
      const paint = (attrs: Record<string, unknown>) => {
        const mine = ++generation;
        const src = String(attrs.src ?? "");
        applyLayout(figure, img, String(attrs.ial ?? ""));
        figure.toggleAttribute("data-join", Boolean(attrs.joinPrevious));
        img.alt = String(attrs.alt ?? "");
        alt.textContent = attrs.alt ? String(attrs.alt) : "Add alt text";
        alt.classList.toggle("is-empty", !attrs.alt);
        img.onerror = null;
        if (isLocalSrc(src)) {
          void resolveLocalSrc(src)
            .catch(() => null)
            .then((url) => {
              if (mine !== generation) {
                return;
              }
              img.src = url ?? "";
              figure.classList.toggle("is-missing", !url);
            });
        } else {
          figure.classList.remove("is-missing");
          const published = displaySrc(src);
          img.onerror = () => {
            const converted = published.replace(/\.(jpe?g|png|tiff?|bmp)$/i, ".webp");
            img.onerror = null;
            if (converted !== published) {
              img.src = converted;
            }
          };
          img.src = published;
        }
      };
      paint(node.attrs);

      alt.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const pos = getPos();
        if (typeof pos !== "number") {
          return;
        }
        const current = editor.state.doc.nodeAt(pos);
        if (!current) {
          return;
        }
        const field = document.createElement("input");
        field.className = "editor-image-alt-input";
        field.placeholder = "Alt text (describes the image)";
        field.value = String(current.attrs.alt ?? "");
        const finish = (commit: boolean) => {
          if (!field.isConnected) {
            return;
          }
          if (commit) {
            const at = getPos();
            const target = typeof at === "number" ? editor.state.doc.nodeAt(at) : null;
            if (typeof at === "number" && target) {
              editor.view.dispatch(
                editor.state.tr.setNodeMarkup(at, undefined, {
                  ...target.attrs,
                  alt: field.value.trim(),
                }),
              );
            }
          }
          field.replaceWith(alt);
        };
        field.addEventListener("keydown", (press) => {
          press.stopPropagation();
          if (press.key === "Enter") {
            press.preventDefault();
            finish(true);
          } else if (press.key === "Escape") {
            press.preventDefault();
            finish(false);
          }
        });
        field.addEventListener("blur", () => finish(true));
        alt.replaceWith(field);
        field.focus();
        field.select();
      });

      caption.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const pos = getPos();
        if (typeof pos !== "number") {
          return;
        }
        const current = editor.state.doc.nodeAt(pos);
        if (!current) {
          return;
        }
        const after = pos + current.nodeSize;
        const sibling = editor.state.doc.resolve(after).nodeAfter;
        if (sibling?.type.name === "paragraph" && sibling.attrs.joinPrevious) {
          editor.chain().focus(after + sibling.nodeSize - 1).run();
          return;
        }
        editor
          .chain()
          .insertContentAt(after, {
            type: "paragraph",
            attrs: { joinPrevious: true, sameLine: true },
          })
          .focus(after + 1)
          .setMark("italic")
          .run();
      });

      tools.append(alt, caption);
      figure.append(img, tools);

      return {
        dom: figure,
        update: (updated) => {
          if (updated.type.name !== node.type.name) {
            return false;
          }
          paint(updated.attrs);
          return true;
        },
        selectNode: () => figure.classList.add("is-selected"),
        deselectNode: () => figure.classList.remove("is-selected"),
        stopEvent: (event) => tools.contains(event.target as Node),
        ignoreMutation: () => true,
      };
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      ...(this.parent?.() ?? []),
      new Plugin<number>({
        key: epochKey,
        state: {
          init: () => 0,
          apply: (tr, epoch, previous) => (swapsDocument(tr, previous) ? epoch + 1 : epoch),
        },
      }),
      new Plugin({
        key: new PluginKey("localImageDropPaste"),
        props: {
          handlePaste: (_view, event) => {
            const files = imageFilesFrom(event.clipboardData?.items);
            if (!files.length) {
              return false;
            }
            event.preventDefault();
            editor.commands.insertLocalImages(files);
            return true;
          },
          handleDrop: (view, event) => {
            const files = imageFilesFrom((event as DragEvent).dataTransfer?.files);
            if (!files.length) {
              return false;
            }
            event.preventDefault();
            const coords = view.posAtCoords({
              left: (event as DragEvent).clientX,
              top: (event as DragEvent).clientY,
            });
            if (coords) {
              editor.commands.focus(coords.pos);
            }
            editor.commands.insertLocalImages(files);
            return true;
          },
        },
      }),
    ];
  },
});
