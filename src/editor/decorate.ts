import { isLocalSrc, resolveLocalSrc } from "../lib/db.ts";
import { convertedSrc } from "../lib/site.ts";
import { embedTag, embedUrl, GALLERY_LABELS, isGalleryKind } from "./blog.ts";
import { BLANK_SRC, TRANSIENT } from "./bridge.ts";
import { renderChart, renderMermaid, type Teardown } from "./render.ts";

/**
 * What the editor shows but does not keep. Elements marked `data-transient`
 * are skipped when the HTML is read back (`htmlToDoc`), so the players,
 * section toggles, gallery labels, photo tools and diagram previews drawn
 * here never reach a draft. Everything here is idempotent: it runs after every
 * load and every edit, and only touches what changed.
 */

const RENDERED = new Set(["mermaid", "chart"]);
const REDRAW_MS = 400;

const WIDTH_CLASSES: Record<string, string> = {
  "w-25": "25%",
  "w-50": "50%",
  "w-75": "75%",
  normal: "100%",
};

function transient<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.setAttribute(TRANSIENT, "true");
  element.contentEditable = "false";
  return element;
}

function firstTransient(parent: Element, className: string): HTMLElement | null {
  return parent.querySelector<HTMLElement>(`:scope > .${className}[${TRANSIENT}]`);
}

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

/** Lays a photo out the way the blog's attribute list says: width, float, shadow, the row's gap. */
function applyLayout(figure: HTMLElement, image: HTMLImageElement): void {
  const { classes, attrs } = parseIal(figure.getAttribute("data-ial") ?? "");
  const fraction = classes.find((name) => name in WIDTH_CLASSES);
  const width = Number(attrs.width ?? attrs.w);
  const height = Number(attrs.height ?? attrs.h);
  figure.style.width = fraction ? WIDTH_CLASSES[fraction] : "";
  image.style.aspectRatio = width && height ? `${width} / ${height}` : "";
  figure.classList.toggle("is-left", classes.includes("left"));
  figure.classList.toggle("is-right", classes.includes("right"));
  figure.classList.toggle("is-shadowed", classes.includes("shadow"));
  figure.classList.toggle("is-gapped", classes.includes("gap"));
  figure.classList.toggle("is-rounded", classes.some((name) => name.startsWith("rounded")));
  figure.classList.toggle("is-light", classes.includes("light"));
  figure.classList.toggle("is-dark", classes.includes("dark"));
}

/** A JPEG the blog's build converted is served as WebP; try that when the name as written is gone. */
function fallBackToWebp(this: HTMLImageElement): void {
  const converted = convertedSrc(this.src);
  this.onerror = null;
  if (converted !== this.src) {
    this.src = converted;
  }
}

/** The alt-text and caption buttons under a photo; a gallery photo's caption is the title its card shows. */
function imageTools(figure: HTMLElement, img: HTMLImageElement): void {
  let tools = firstTransient(figure, "editor-image-tools");
  if (!tools) {
    tools = transient("div", "editor-image-tools");
    const alt = document.createElement("button");
    alt.type = "button";
    alt.className = "editor-image-alt";
    const caption = document.createElement("button");
    caption.type = "button";
    caption.className = "editor-image-alt editor-image-caption";
    tools.append(alt, caption);
    figure.append(tools);
  }
  const [alt, caption] = [...tools.children] as HTMLButtonElement[];
  const altText = img.getAttribute("alt") ?? "";
  alt.textContent = altText || "Add alt text";
  alt.classList.toggle("is-empty", !altText);
  const gallery = Boolean(figure.closest("[data-gallery]"));
  const title = img.getAttribute("title") ?? "";
  caption.textContent = gallery && title ? title : "Add caption";
  caption.classList.toggle("is-empty", gallery && !title);
}

function images(root: HTMLElement): void {
  for (const figure of root.querySelectorAll<HTMLElement>("figure[data-image]")) {
    const img = figure.querySelector("img");
    if (!img) {
      continue;
    }
    applyLayout(figure, img);
    imageTools(figure, img);
    img.draggable = false;
    const local = img.getAttribute("data-local-src");
    if (local && isLocalSrc(local)) {
      if (img.getAttribute("src") === BLANK_SRC) {
        void resolveLocalSrc(local)
          .catch(() => null)
          .then((url) => {
            if (url && img.getAttribute("data-local-src") === local) {
              img.src = url;
            }
            figure.classList.toggle("is-missing", !url);
          });
      }
    } else if (!img.onerror) {
      img.onerror = fallBackToWebp;
    }
  }
}

function galleries(root: HTMLElement): void {
  for (const gallery of root.querySelectorAll<HTMLElement>("[data-gallery]")) {
    const kind = gallery.getAttribute("data-kind") ?? "deck";
    const text = `Gallery · ${isGalleryKind(kind) ? GALLERY_LABELS[kind] : kind}`;
    let label = firstTransient(gallery, "editor-gallery-label");
    if (!label) {
      label = transient("span", "editor-gallery-label");
      gallery.prepend(label);
    }
    if (label.textContent !== text) {
      label.textContent = text;
    }
  }
}

function player(platform: string, id: string): HTMLElement {
  const frame = transient("div", "embed-frame");
  if (platform === "youtube") {
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
    iframe.title = "YouTube video player";
    iframe.loading = "lazy";
    iframe.allow = "accelerometer; encrypted-media; picture-in-picture";
    iframe.allowFullscreen = true;
    frame.append(iframe);
  } else {
    const card = document.createElement("a");
    card.className = "embed-card";
    const href = embedUrl(platform, id);
    if (href) {
      card.href = href;
      card.target = "_blank";
      card.rel = "noreferrer noopener";
    }
    card.textContent = `${platform} · ${id}`;
    frame.append(card);
  }
  const note = document.createElement("span");
  note.className = "embed-note";
  note.textContent = embedTag(platform, id);
  frame.append(note);
  return frame;
}

function embeds(root: HTMLElement): void {
  for (const embed of root.querySelectorAll<HTMLElement>("[data-embed]")) {
    const platform = embed.getAttribute("data-platform") ?? "youtube";
    const id = embed.getAttribute("data-id") ?? "";
    const key = `${platform}:${id}`;
    const current = firstTransient(embed, "embed-frame");
    if (current?.dataset.key === key) {
      continue;
    }
    current?.remove();
    const frame = player(platform, id);
    frame.dataset.key = key;
    embed.append(frame);
  }
}

function sections(root: HTMLElement): void {
  for (const section of root.querySelectorAll<HTMLElement>("[data-collapsible]")) {
    let toggle = firstTransient(section, "collapsible-toggle");
    if (!toggle) {
      toggle = transient("button", "collapsible-toggle");
      toggle.setAttribute("type", "button");
      toggle.setAttribute("aria-label", "Toggle section");
      section.prepend(toggle);
    }
    const open = section.getAttribute("data-open") !== "false";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "▾" : "▸";
  }
}

interface Preview {
  element: HTMLElement;
  source: string;
  dark: boolean;
  generation: number;
  timer?: number;
  teardown?: Teardown;
}

/** Mermaid and chart fences drawn above their source, redrawn a moment after the source stops changing. */
export class Previews {
  private readonly live = new Map<HTMLElement, Preview>();
  private serial = 0;

  sync(root: HTMLElement, dark: boolean): void {
    const seen = new Set<HTMLElement>();
    for (const pre of root.querySelectorAll<HTMLElement>("pre[data-language]")) {
      const language = pre.getAttribute("data-language") ?? "";
      const source = pre.textContent ?? "";
      if (!RENDERED.has(language) || !source.trim()) {
        continue;
      }
      seen.add(pre);
      let preview = this.live.get(pre);
      if (!preview) {
        preview = { element: transient("div", "block-preview"), source, dark, generation: 0 };
        this.live.set(pre, preview);
        this.draw(preview, language);
      } else if (preview.source !== source || preview.dark !== dark) {
        preview.source = source;
        preview.dark = dark;
        window.clearTimeout(preview.timer);
        const current = preview;
        current.timer = window.setTimeout(() => this.draw(current, language), REDRAW_MS);
      }
      if (pre.previousElementSibling !== preview.element) {
        pre.before(preview.element);
      }
    }
    for (const [pre, preview] of this.live) {
      if (!seen.has(pre)) {
        this.drop(pre, preview);
      }
    }
    for (const stray of root.querySelectorAll(`.block-preview[${TRANSIENT}]`)) {
      if (![...this.live.values()].some((preview) => preview.element === stray)) {
        stray.remove();
      }
    }
  }

  clear(): void {
    for (const [pre, preview] of this.live) {
      this.drop(pre, preview);
    }
  }

  private draw(preview: Preview, language: string): void {
    const mine = ++preview.generation;
    const key = `${++this.serial}-${mine}`;
    preview.teardown?.();
    preview.teardown = undefined;
    const started =
      language === "mermaid"
        ? renderMermaid(preview.source, preview.element, preview.dark, `mermaid-${key}`)
        : renderChart(preview.source, preview.element, preview.dark);
    void started.then((teardown) => {
      if (mine !== preview.generation) {
        teardown();
        return;
      }
      preview.teardown = teardown;
    });
  }

  private drop(pre: HTMLElement, preview: Preview): void {
    window.clearTimeout(preview.timer);
    preview.generation += 1;
    preview.teardown?.();
    preview.element.remove();
    this.live.delete(pre);
  }
}

export function decorate(root: HTMLElement, previews: Previews, dark: boolean): void {
  images(root);
  galleries(root);
  embeds(root);
  sections(root);
  previews.sync(root, dark);
}
