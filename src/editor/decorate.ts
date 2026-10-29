import { isLocalSrc, localId, releaseDisplays, resolveDisplaySrc } from "../lib/db.ts";
import { convertedSrc, fullSrc } from "../lib/site.ts";
import { isDropbox } from "../../shared/media.ts";
import { embedField, embedTag, embedUrl, playableUrl, youtubeOf } from "./blog.ts";
import { BLANK_SRC, TRANSIENT } from "./bridge.ts";
import { renderChart, renderDiagram, type Teardown } from "./render.ts";

const RENDERED = new Set(["diagram", "chart"]);
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

function applyTheme(figure: HTMLElement): void {
  const ial = figure.getAttribute("data-ial") ?? "";
  figure.classList.toggle("is-light", /\.light(?![\w-])/.test(ial));
  figure.classList.toggle("is-dark", /\.dark(?![\w-])/.test(ial));
}

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

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

function setAttr(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
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
  setText(alt, altText || "Add alt text");
  setAttr(alt, "title", altText);
  alt.classList.toggle("is-empty", !altText);
  const text = img.getAttribute("title") ?? "";
  setText(caption, text || "Add caption");
  setAttr(caption, "title", text);
  caption.classList.toggle("is-empty", !text);
  for (const edit of edits) {
    if (edit.hidden === gallery) {
      edit.hidden = !gallery;
    }
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
    setAttr(img, "draggable", "false");
    setAttr(figure, "draggable", "true");
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
      label.draggable = true;
      label.title = "Drag to move the gallery";
      gallery.prepend(label);
    }
    setText(label, "Gallery");
  }
}

const STREAM = /\.m3u8(?:[?#]|$)/i;

function frameOf(src: string, title: string): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.title = title;
  iframe.loading = "lazy";
  iframe.allow = "accelerometer; encrypted-media; picture-in-picture";
  iframe.allowFullscreen = true;
  return iframe;
}

function videoOf(src: string, extra: string | undefined, warning: HTMLElement): HTMLVideoElement {
  const video = document.createElement("video");
  video.className = "embed-video";
  video.controls = true;
  video.preload = "metadata";
  video.playsInline = true;
  video.poster = embedField(extra, "poster") ?? "";
  const shape = (width: number, height: number) => {
    if (width > 0 && height > 0) {
      video.style.setProperty("--r", String(width / height));
    }
  };
  shape(Number(embedField(extra, "width")), Number(embedField(extra, "height")));
  video.addEventListener("loadedmetadata", () => {
    warning.hidden = video.videoWidth > 0;
    shape(video.videoWidth, video.videoHeight);
  });
  video.addEventListener("error", () => (warning.hidden = false));
  video.src = src;
  return video;
}

function player(platform: string, id: string, extra?: string): HTMLElement {
  const frame = transient("div", "embed-frame");
  const tube = platform === "video" ? youtubeOf(id) : null;
  const file = platform === "video" && !tube ? embedUrl(platform, id) : null;
  if (platform === "youtube" || tube) {
    const iframe = frameOf(`https://www.youtube-nocookie.com/embed/${encodeURIComponent(tube?.id ?? id)}${tube?.start ? `?start=${tube.start}` : ""}`, "YouTube video player");
    if (tube?.short) {
      iframe.className = "embed-video";
      iframe.style.setProperty("--r", String(9 / 16));
    }
    frame.append(iframe);
  } else if (file) {
    const warning = document.createElement("span");
    warning.className = "embed-warning";
    warning.textContent = STREAM.test(file) && !document.createElement("video").canPlayType("application/vnd.apple.mpegurl")
      ? "This browser plays a stream only on the blog, which loads a player for it."
      : "This browser cannot show this video's picture, and some readers' cannot either."
        + (isDropbox(file) ? " Convert it to an MP4 every browser plays." : " Replace it with an upload, which is made one every browser plays.");
    warning.hidden = true;
    frame.append(videoOf(playableUrl(file), extra, warning), warning);
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
  note.textContent = embedTag(platform, id, extra);
  frame.append(note);
  if (file) {
    const tools = document.createElement("div");
    tools.className = "editor-embed-tools";
    if (isDropbox(id)) {
      tools.append(toolButton("editor-embed-replace editor-embed-convert", "Convert to MP4", "Fetch it from Dropbox, make it an MP4 every browser plays, and keep it in the media bucket"));
    }
    tools.append(toolButton("editor-embed-replace", "Replace video", "Upload another video in this one's place"));
    frame.append(tools);
  }
  return frame;
}

function embeds(root: HTMLElement): void {
  for (const embed of root.querySelectorAll<HTMLElement>("[data-embed]")) {
    const platform = embed.getAttribute("data-platform") ?? "youtube";
    const id = embed.getAttribute("data-id") ?? "";
    const extra = embed.getAttribute("data-extra") ?? undefined;
    const key = `${platform}:${id}:${extra ?? ""}`;
    const current = firstTransient(embed, "embed-frame");
    if (current?.dataset.key === key) {
      continue;
    }
    current?.remove();
    const frame = player(platform, id, extra);
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
    setAttr(toggle, "aria-expanded", String(open));
    setText(toggle, open ? "▾" : "▸");
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

export class Previews {
  private readonly live = new Map<HTMLElement, Preview>();

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
      } else if (preview.source !== source || (language === "chart" && preview.dark !== dark)) {
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
    preview.teardown?.();
    preview.teardown = undefined;
    const started =
      language === "diagram"
        ? renderDiagram(preview.source, preview.element, () => mine === preview.generation)
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

export function releasePhotos(): void {
  const shown = document.querySelectorAll("img[data-local-src]");
  releaseDisplays(new Set([...shown].map((img) => localId(img.getAttribute("data-local-src") ?? ""))));
}
