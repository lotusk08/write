import { isLocalSrc, localId, releaseDisplays, resolveDisplaySrc } from "../lib/db.ts";
import { convertedSrc, fullSrc } from "../lib/site.ts";
import { embedTag, embedUrl } from "./blog.ts";
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

/** Shows a photo for one theme only, as the blog's `.light` and `.dark` do; the layout classes it no longer draws are kept in the markdown but not previewed. */
function applyTheme(figure: HTMLElement): void {
  const ial = figure.getAttribute("data-ial") ?? "";
  figure.classList.toggle("is-light", /\.light(?![\w-])/.test(ial));
  figure.classList.toggle("is-dark", /\.dark(?![\w-])/.test(ial));
}

/**
 * A photo is shown from the site's 960px copy; when that is missing it falls back to the original, and a JPEG the
 * blog's build converted is served as WebP, tried when the name as written is gone.
 */
function fallBackToWebp(this: HTMLImageElement): void {
  const full = fullSrc(this.src);
  if (full !== this.src) {
    this.src = full;
    return;
  }
  const converted = convertedSrc(this.src);
  this.onerror = null;
  if (converted !== this.src) {
    this.src = converted;
  }
}

function toolButton(className: string, text = "", label = ""): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  if (label) {
    button.setAttribute("aria-label", label);
    button.title = label;
  }
  return button;
}

function editButton(step: -1 | 0 | 1, text: string, label: string): HTMLButtonElement {
  const button = toolButton("tool editor-image-edit", text, label);
  button.dataset.step = String(step);
  return button;
}

/**
 * The buttons under a photo: alt text and caption, apart. A photo's caption is its title, written
 * `![alt](src "caption")`, which the blog draws under it, in a gallery or not; the selected gallery photo also gets
 * move and remove. A photo whose caption is still the italic line under it has that line edited in place, and the
 * stylesheet hides the button.
 */
function imageTools(figure: HTMLElement, img: HTMLImageElement): void {
  let tools = firstTransient(figure, "editor-image-tools");
  if (!tools) {
    tools = transient("div", "editor-image-tools");
    tools.append(
      toolButton("editor-image-alt"),
      toolButton("editor-image-alt editor-image-caption"),
      editButton(-1, "←", "Move photo back"),
      editButton(1, "→", "Move photo on"),
      editButton(0, "Remove", "Remove photo from the gallery"),
    );
    figure.append(tools);
  }
  const [alt, caption, ...edits] = [...tools.children] as HTMLButtonElement[];
  const gallery = Boolean(figure.closest("[data-gallery]"));
  const altText = img.getAttribute("alt") ?? "";
  alt.textContent = altText || "Add alt text";
  alt.title = altText;
  alt.classList.toggle("is-empty", !altText);
  const text = img.getAttribute("title") ?? "";
  caption.textContent = text || "Add caption";
  caption.title = text;
  caption.classList.toggle("is-empty", !text);
  for (const edit of edits) {
    edit.hidden = !gallery;
  }
}

function images(root: HTMLElement): void {
  for (const figure of root.querySelectorAll<HTMLElement>("figure[data-image]")) {
    const img = figure.querySelector("img");
    if (!img) {
      continue;
    }
    applyTheme(figure);
    imageTools(figure, img);
    img.draggable = false;
    const local = img.getAttribute("data-local-src");
    if (local && isLocalSrc(local)) {
      if (img.getAttribute("src") === BLANK_SRC) {
        void resolveDisplaySrc(local)
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
    let label = firstTransient(gallery, "editor-gallery-label");
    if (!label) {
      label = transient("span", "editor-gallery-label");
      gallery.prepend(label);
    }
    if (label.textContent !== "Gallery") {
      label.textContent = "Gallery";
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
        : renderChart(preview.source, preview.element);
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

/** Frees the shown copies of stored photos once no editor on the page shows them. */
export function releasePhotos(): void {
  const shown = document.querySelectorAll("img[data-local-src]");
  releaseDisplays(new Set([...shown].map((img) => localId(img.getAttribute("data-local-src") ?? ""))));
}
