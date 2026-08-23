import Image from "@tiptap/extension-image";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";
import { LOCAL_PREFIX, isLocalSrc, resolveLocalSrc, storeImageFile } from "../../lib/db.ts";
import { displaySrc } from "../../lib/site.ts";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    localImage: {
      /** Stores the file in IndexedDB and inserts it at the cursor. */
      insertLocalImage: (file: File) => ReturnType;
    };
  }
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

/** Widths the blog's stylesheet defines, as fractions of the column. */
const WIDTH_CLASSES: Record<string, string> = {
  "w-25": "25%",
  "w-50": "50%",
  "w-75": "75%",
  normal: "100%",
};

/**
 * Splits a Kramdown attribute list into its classes and its key/value pairs.
 * Quoted values are taken whole, so the base64 sitting inside `lqip="…"` can
 * never be mistaken for a class or a width of its own.
 */
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

/**
 * Reads a Kramdown attribute list the way the blog's stylesheet does, so an
 * imported photo is the size and shape here that it is on the site. Width is a
 * class there; `w`/`h` are the natural dimensions the blog's build writes, and
 * are worth only an aspect ratio, which keeps the page from jumping as the
 * photos arrive.
 */
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
  figure.classList.toggle("is-rounded", classes.some((name) => name.startsWith("rounded")));
  // The site serves one of these per theme; showing both would be a surprise.
  figure.dataset.scheme = classes.includes("light")
    ? "light"
    : classes.includes("dark")
      ? "dark"
      : "";
}

/**
 * Images live in IndexedDB, not in the document: the node stores a
 * `local:<id>` src that is resolved to an object URL for display and to a real
 * blog path at publish time. That keeps drafts small and survives reloads.
 */
export const LocalImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
      /**
       * The Kramdown attribute list an imported image was published with —
       * `{: lqip="…" w="…" }`, which the blog's build writes and its lazy
       * loading reads. Carried through untouched so re-publishing keeps it.
       */
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
      insertLocalImage:
        (file: File) =>
        ({ editor }) => {
          void storeImageFile(file).then((stored) => {
            editor
              .chain()
              .focus()
              .insertContent({
                type: this.name,
                attrs: { src: `${LOCAL_PREFIX}${stored.id}`, alt: "", title: null },
              })
              .run();
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

      const caption = document.createElement("button");
      caption.type = "button";
      caption.className = "editor-image-alt";
      caption.contentEditable = "false";

      const paint = (attrs: Record<string, unknown>) => {
        const src = String(attrs.src ?? "");
        // The blog lays images out from the attribute list they carry, so the
        // editor reads the same one rather than guessing.
        applyLayout(figure, img, String(attrs.ial ?? ""));
        figure.toggleAttribute("data-join", Boolean(attrs.joinPrevious));
        img.alt = String(attrs.alt ?? "");
        caption.textContent = attrs.alt ? String(attrs.alt) : "Add alt text";
        caption.classList.toggle("is-empty", !attrs.alt);
        if (isLocalSrc(src)) {
          void resolveLocalSrc(src).then((url) => {
            img.src = url ?? "";
            figure.classList.toggle("is-missing", !url);
          });
        } else {
          img.src = displaySrc(src);
        }
      };
      paint(node.attrs);

      caption.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const pos = getPos();
        if (typeof pos !== "number") {
          return;
        }
        const current = editor.state.doc.nodeAt(pos);
        const next = window.prompt("Alt text (describes the image)", String(current?.attrs.alt ?? ""));
        if (next === null || !current) {
          return;
        }
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, alt: next }),
        );
      });

      figure.append(img, caption);

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
        stopEvent: (event) => event.target === caption,
        ignoreMutation: () => true,
      };
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: new PluginKey("localImageDropPaste"),
        props: {
          handlePaste: (_view, event) => {
            const files = imageFilesFrom(event.clipboardData?.items);
            if (!files.length) {
              return false;
            }
            event.preventDefault();
            files.forEach((file) => editor.commands.insertLocalImage(file));
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
            files.forEach((file) => editor.commands.insertLocalImage(file));
            return true;
          },
        },
      }),
    ];
  },
});
