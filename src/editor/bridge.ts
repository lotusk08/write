import { isLocalSrc } from "../lib/db.ts";
import { previewSrc } from "../lib/site.ts";
import type { DocMark, JSONContent } from "./doc.ts";

/**
 * The editor holds HTML; a draft holds the JSON tree `import.ts` reads a post
 * into and `markdown.ts` writes it back from. This file is the one place the
 * two meet. Every attribute the writer consults rides on the element as a
 * `data-*` attribute (the names the Tiptap schema already rendered them under,
 * so the stylesheet's selectors still hold), and the parser reads them back
 * from there — `docToHtml` then `htmlToDoc` must hand the writer back what it
 * was given, which `bridge.test.ts` checks against the blog's own posts.
 *
 * Two conventions of `contenteditable` are followed both ways: a block's last
 * `<br>` is the browser's placeholder rather than a line break, so a break that
 * really ends a line is written as two; and an empty block holds a lone `<br>`.
 */

/** Marks what the editor shows but a draft does not keep: players, toggles, previews, photo tools. */
export const TRANSIENT = "data-transient";

/** What an `<img>` points at while its real address waits to be resolved. */
export const BLANK_SRC = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const BLOCK_ATTRS = {
  blockIal: "data-block-ial",
  ialAbove: "data-ial-above",
  joinPrevious: "data-join",
  sameLine: "data-same-line",
  lazy: "data-lazy",
} as const;

type BlockAttr = keyof typeof BLOCK_ATTRS;

const MARK_TAGS: Record<string, string> = {
  bold: "strong",
  italic: "em",
  strike: "s",
  underline: "u",
  highlight: "mark",
  superscript: "sup",
  subscript: "sub",
  code: "code",
  link: "a",
};

const TAG_MARKS: Record<string, string> = {
  strong: "bold",
  b: "bold",
  em: "italic",
  i: "italic",
  s: "strike",
  strike: "strike",
  del: "strike",
  u: "underline",
  ins: "underline",
  mark: "highlight",
  sup: "superscript",
  sub: "subscript",
  code: "code",
};

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "details", "div", "dl", "figure", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "img", "li", "main", "nav", "ol", "p",
  "pre", "section", "table", "ul",
]);

/** The URLs the editor's sanitizer lets through on an `<img src>`. */
const SHOWABLE = /^(?:https?:|blob:|data:image\/(?:png|jpeg|gif|webp);base64,|[^:]*$)/i;

export interface RenderOptions {
  /** Where an image published under `src` is shown from; the site's own address by default. */
  display?: (src: string) => string;
}

// ---------------------------------------------------------------- doc → HTML

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (char) => (char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;"));
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function attr(name: string, value: unknown): string {
  if (value === null || value === undefined || value === false || value === "") {
    return "";
  }
  return value === true ? ` ${name}` : ` ${name}="${escapeAttr(String(value))}"`;
}

function blockAttrs(node: JSONContent): string {
  return (Object.keys(BLOCK_ATTRS) as BlockAttr[])
    .map((key) => attr(BLOCK_ATTRS[key], node.attrs?.[key]))
    .join("");
}

function hasBlockAttrs(node: JSONContent): boolean {
  return (Object.keys(BLOCK_ATTRS) as BlockAttr[]).some((key) => {
    const value = node.attrs?.[key];
    return value !== null && value !== undefined && value !== false && value !== "";
  });
}

function wrapMark(inner: string, mark: DocMark): string {
  const within = attr("data-within", mark.attrs?.within);
  switch (mark.type) {
    case "link":
      return `<a${attr("href", mark.attrs?.href ?? "")}${attr("title", mark.attrs?.title)}${within}>${inner}</a>`;
    case "code":
      return `<code${mark.attrs?.filepath ? ' class="filepath"' : ""}${within}>${inner}</code>`;
    case "rawInline":
      return `<span class="raw-inline" data-raw-inline${within}>${inner}</span>`;
    default: {
      const tag = MARK_TAGS[mark.type];
      return tag
        ? `<${tag}${within}>${inner}</${tag}>`
        : `<span${attr("data-mark", mark.type)}${within}>${inner}</span>`;
    }
  }
}

function withMarks(inner: string, marks: DocMark[] | undefined): string {
  return (marks ?? []).reduceRight(wrapMark, inner);
}

function inlineHtml(nodes: JSONContent[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return withMarks(escapeText(node.text ?? ""), node.marks);
        case "hardBreak":
          return withMarks("<br>", node.marks);
        case "footnoteRef": {
          const label = String(node.attrs?.label ?? "1");
          return withMarks(
            `<sup class="footnote-ref"${attr("data-footnote-ref", label)} contenteditable="false">${escapeText(label)}</sup>`,
            node.marks,
          );
        }
        default:
          return node.content ? inlineHtml(node.content) : "";
      }
    })
    .join("");
}

function textblockBody(node: JSONContent): string {
  const content = node.content ?? [];
  if (!content.length) {
    return "<br>";
  }
  return inlineHtml(content) + (content[content.length - 1].type === "hardBreak" ? "<br>" : "");
}

function preText(node: JSONContent): string {
  const text = (node.content ?? []).map((child) => child.text ?? "").join("");
  if (!text) {
    return "<br>";
  }
  return escapeText(text) + (text.endsWith("\n") ? "\n" : "");
}

/** A list item's or a cell's body: its leading plain paragraph is written bare, as typing makes it. */
function itemBody(content: JSONContent[] | undefined, options: RenderOptions): string {
  const [first, ...rest] = content ?? [];
  if (!first) {
    return "<br>";
  }
  if (first.type === "paragraph" && !hasBlockAttrs(first)) {
    return textblockBody(first) + blocksHtml(rest, options);
  }
  return blocksHtml(content ?? [], options);
}

function imageHtml(node: JSONContent, options: RenderOptions): string {
  const src = String(node.attrs?.src ?? "");
  const display = options.display ?? previewSrc;
  let source: string;
  if (isLocalSrc(src)) {
    source = `${attr("src", BLANK_SRC)}${attr("data-local-src", src)}`;
  } else {
    const shown = display(src);
    source = `${attr("src", SHOWABLE.test(shown) ? shown : BLANK_SRC)}${attr("data-src", src)}`;
  }
  return (
    `<figure class="editor-image" data-image contenteditable="false"${attr("data-ial", node.attrs?.ial)}${blockAttrs(node)}>` +
    `<img${source} alt="${escapeAttr(String(node.attrs?.alt ?? ""))}"${attr("title", node.attrs?.title)}>` +
    "</figure>"
  );
}

function blockHtml(node: JSONContent, options: RenderOptions): string {
  const extra = blockAttrs(node);
  const children = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return `<p${extra}>${textblockBody(node)}</p>`;
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 6);
      return `<h${level}${extra}>${textblockBody(node)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote${attr("data-note", node.attrs?.note)}${extra}>${blocksHtml(children, options) || "<p><br></p>"}</blockquote>`;
    case "codeBlock":
      return `<pre${attr("data-language", node.attrs?.language)}${extra}><code>${preText(node)}</code></pre>`;
    case "rawBlock":
      return `<pre class="raw-block" data-raw${extra}>${preText(node)}</pre>`;
    case "bulletList":
      return `<ul${extra}>${blocksHtml(children, options)}</ul>`;
    case "taskList":
      return `<ul data-task-list${extra}>${blocksHtml(children, options)}</ul>`;
    case "orderedList": {
      const start = Number(node.attrs?.start ?? 1);
      return `<ol${attr("start", start === 1 ? null : start)}${extra}>${blocksHtml(children, options)}</ol>`;
    }
    case "listItem":
      return `<li>${itemBody(children, options)}</li>`;
    case "taskItem":
      return `<li data-checked="${node.attrs?.checked ? "true" : "false"}">${itemBody(children, options)}</li>`;
    case "table":
      return `<table${extra}><tbody>${blocksHtml(children, options)}</tbody></table>`;
    case "tableRow":
      return `<tr>${blocksHtml(children, options)}</tr>`;
    case "tableHeader":
    case "tableCell": {
      const tag = node.type === "tableHeader" ? "th" : "td";
      const align = node.attrs?.align ? ` style="text-align: ${escapeAttr(String(node.attrs.align))}"` : "";
      const colspan = Number(node.attrs?.colspan ?? 1);
      const rowspan = Number(node.attrs?.rowspan ?? 1);
      return `<${tag}${align}${attr("colspan", colspan > 1 ? colspan : null)}${attr("rowspan", rowspan > 1 ? rowspan : null)}>${itemBody(children, options)}</${tag}>`;
    }
    case "horizontalRule":
      return `<hr${extra}>`;
    case "image":
      return imageHtml(node, options);
    case "gallery":
      return (
        `<figure class="editor-gallery" data-gallery contenteditable="false"${extra}>` +
        `<div class="editor-gallery-strip">${blocksHtml(children, options)}</div></figure>`
      );
    case "embed":
      return `<div class="embed-block" data-embed${attr("data-platform", node.attrs?.platform ?? "youtube")}${attr("data-id", node.attrs?.id ?? "")} contenteditable="false"${extra}></div>`;
    case "collapsible": {
      const summary = children.find((child) => child.type === "collapsibleSummary") ?? {};
      const body = children.find((child) => child.type === "collapsibleContent")?.content ?? [];
      return (
        `<div class="collapsible" data-collapsible data-open="${node.attrs?.open === false ? "false" : "true"}"${extra}>` +
        `<div class="collapsible-summary" data-collapsible-summary>${textblockBody(summary)}</div>` +
        `<div class="collapsible-content" data-collapsible-content>${blocksHtml(body, options) || "<p><br></p>"}</div>` +
        "</div>"
      );
    }
    case "footnoteDef":
      return `<div class="footnote"${attr("data-footnote", node.attrs?.label ?? "1")}${extra}>${blocksHtml(children, options) || "<p><br></p>"}</div>`;
    default:
      return blocksHtml(children, options);
  }
}

function blocksHtml(nodes: JSONContent[], options: RenderOptions): string {
  return nodes.map((node) => blockHtml(node, options)).join("");
}

export function docToHtml(doc: JSONContent, options: RenderOptions = {}): string {
  return blocksHtml(doc.content ?? [], options) || "<p><br></p>";
}

// ---------------------------------------------------------------- HTML → doc

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function tagOf(node: Node): string {
  return isElement(node) ? node.tagName.toLowerCase() : "";
}

function isTransient(node: Node): boolean {
  return isElement(node) && node.hasAttribute(TRANSIENT);
}

function isBlock(node: Node): boolean {
  return BLOCK_TAGS.has(tagOf(node));
}

function readBlockAttrs(element: Element): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(BLOCK_ATTRS) as BlockAttr[]) {
    const name = BLOCK_ATTRS[key];
    if (!element.hasAttribute(name)) {
      continue;
    }
    out[key] = key === "blockIal" ? element.getAttribute(name) : true;
  }
  return out;
}

function withAttrs(node: JSONContent, attrs: Record<string, unknown>): JSONContent {
  return Object.keys(attrs).length ? { ...node, attrs: { ...node.attrs, ...attrs } } : node;
}

function sameMarks(a: DocMark[] | undefined, b: DocMark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function addMark(marks: DocMark[], mark: DocMark): DocMark[] {
  return [...marks.filter((existing) => existing.type !== mark.type), mark];
}

function markFrom(element: Element): DocMark | null {
  const tag = tagOf(element);
  const within = element.getAttribute("data-within");
  const withWithin = (mark: DocMark): DocMark =>
    within ? { ...mark, attrs: { ...mark.attrs, within } } : mark;

  if (tag === "a") {
    const href = element.getAttribute("href");
    if (href === null) {
      return null;
    }
    const title = element.getAttribute("title");
    return withWithin({ type: "link", attrs: { href, ...(title ? { title } : {}) } });
  }
  if (tag === "code") {
    return withWithin(
      element.classList.contains("filepath") ? { type: "code", attrs: { filepath: true } } : { type: "code" },
    );
  }
  if (tag === "span") {
    if (element.hasAttribute("data-raw-inline")) {
      return withWithin({ type: "rawInline" });
    }
    const named = element.getAttribute("data-mark");
    if (named) {
      return withWithin({ type: named });
    }
    const style = element.getAttribute("style") ?? "";
    if (/font-weight:\s*(?:bold|[7-9]00)/i.test(style)) {
      return { type: "bold" };
    }
    if (/font-style:\s*italic/i.test(style)) {
      return { type: "italic" };
    }
    if (/text-decoration[^;]*line-through/i.test(style)) {
      return { type: "strike" };
    }
    if (/text-decoration[^;]*underline/i.test(style)) {
      return { type: "underline" };
    }
    return null;
  }
  const type = TAG_MARKS[tag];
  return type ? withWithin({ type }) : null;
}

function imageFrom(element: Element): JSONContent | null {
  const img = tagOf(element) === "img" ? element : element.querySelector("img");
  if (!img) {
    return null;
  }
  const figure = tagOf(element) === "figure" ? element : null;
  const src =
    img.getAttribute("data-local-src") ?? img.getAttribute("data-src") ?? img.getAttribute("src") ?? "";
  if (!src || src === BLANK_SRC) {
    return null;
  }
  const ial = figure?.getAttribute("data-ial") ?? img.getAttribute("data-ial");
  return withAttrs(
    {
      type: "image",
      attrs: { src, alt: img.getAttribute("alt") ?? "", title: img.getAttribute("title") || null },
    },
    { ...(ial ? { ial } : {}), ...readBlockAttrs(figure ?? img) },
  );
}

function inlineFrom(nodes: Iterable<Node>, marks: DocMark[] = []): JSONContent[] {
  const out: JSONContent[] = [];
  const markOf = () => (marks.length ? { marks } : {});
  for (const node of nodes) {
    if (node.nodeType === 3) {
      const parts = (node.nodeValue ?? "").split("\n");
      parts.forEach((part, index) => {
        if (index > 0) {
          out.push({ type: "hardBreak", ...markOf() });
        }
        if (part) {
          out.push({ type: "text", text: part, ...markOf() });
        }
      });
      continue;
    }
    if (!isElement(node) || isTransient(node)) {
      continue;
    }
    const tag = tagOf(node);
    if (tag === "br") {
      out.push({ type: "hardBreak", ...markOf() });
    } else if (tag === "img" || node.hasAttribute("data-image")) {
      const image = imageFrom(node);
      if (image) {
        out.push(image);
      }
    } else if (tag === "sup" && node.hasAttribute("data-footnote-ref")) {
      out.push({ type: "footnoteRef", attrs: { label: node.getAttribute("data-footnote-ref") ?? "1" }, ...markOf() });
    } else if (tag === "input") {
      continue;
    } else {
      const mark = markFrom(node);
      out.push(...inlineFrom(node.childNodes, mark ? addMark(marks, mark) : marks));
    }
  }
  return mergeText(out);
}

function mergeText(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (node.type === "text" && last?.type === "text" && sameMarks(last.marks, node.marks)) {
      out[out.length - 1] = { ...last, text: (last.text ?? "") + (node.text ?? "") };
    } else {
      out.push(node);
    }
  }
  return out;
}

/** A textblock read from its inline content: the placeholder `<br>` dropped, photos lifted out as blocks. */
function textblocks(type: string, attrs: Record<string, unknown>, nodes: Iterable<Node>): JSONContent[] {
  const inline = inlineFrom(nodes);
  if (inline[inline.length - 1]?.type === "hardBreak") {
    inline.pop();
  }
  const make = (content: JSONContent[]): JSONContent =>
    withAttrs({ type, ...(content.length ? { content } : {}) }, attrs);
  if (!inline.some((node) => node.type === "image")) {
    return [make(inline)];
  }
  const out: JSONContent[] = [];
  let run: JSONContent[] = [];
  for (const node of inline) {
    if (node.type === "image") {
      if (run.some((item) => item.type !== "hardBreak")) {
        out.push(make(run));
      }
      run = [];
      out.push(node);
    } else {
      run.push(node);
    }
  }
  if (run.some((item) => item.type !== "hardBreak")) {
    out.push(make(run));
  }
  return out;
}

function significant(run: Node[]): boolean {
  return run.some((node) => {
    if (node.nodeType === 3) {
      const text = node.nodeValue ?? "";
      return text !== "" && !(/^\s*$/.test(text) && text.includes("\n"));
    }
    return isElement(node) && !isTransient(node);
  });
}

function blocksFrom(nodes: Iterable<Node>): JSONContent[] {
  const out: JSONContent[] = [];
  let run: Node[] = [];
  const flush = () => {
    if (significant(run)) {
      out.push(...textblocks("paragraph", {}, run));
    }
    run = [];
  };
  for (const node of nodes) {
    if (isTransient(node) || node.nodeType === 8) {
      continue;
    }
    if (isBlock(node)) {
      flush();
      out.push(...blockFrom(node as Element));
    } else {
      run.push(node);
    }
  }
  flush();
  return out;
}

function blocksOrParagraph(nodes: Iterable<Node>): JSONContent[] {
  const blocks = blocksFrom(nodes);
  return blocks.length ? blocks : [{ type: "paragraph" }];
}

function children(element: Element, selector: string): Element[] {
  return [...element.children].filter((child) => child.matches(selector));
}

function codeText(element: Element): string {
  let text = "";
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      text += node.nodeValue ?? "";
    } else if (isElement(node) && !isTransient(node)) {
      if (tagOf(node) === "br") {
        text += "\n";
      } else {
        node.childNodes.forEach(walk);
        if (tagOf(node) === "div" || tagOf(node) === "p") {
          text += text.endsWith("\n") ? "" : "\n";
        }
      }
    }
  };
  element.childNodes.forEach(walk);
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function textNode(text: string): JSONContent[] {
  return text ? [{ type: "text", text }] : [];
}

function listItem(element: Element): JSONContent {
  const checked = element.getAttribute("data-checked");
  if (checked !== null) {
    return { type: "taskItem", attrs: { checked: checked === "true" }, content: blocksOrParagraph(element.childNodes) };
  }
  const box = children(element, 'input[type="checkbox"]')[0];
  if (!box) {
    return { type: "listItem", content: blocksOrParagraph(element.childNodes) };
  }
  const rest = [...element.childNodes].filter((node) => node !== box);
  const spacer = rest[0];
  if (spacer?.nodeType === 3 && spacer.nodeValue?.startsWith("\u00a0")) {
    const trimmed = spacer.nodeValue.slice(1);
    rest[0] = element.ownerDocument.createTextNode(trimmed);
  }
  return {
    type: "taskItem",
    attrs: { checked: box.hasAttribute("checked") || (box as HTMLInputElement).checked === true },
    content: blocksOrParagraph(rest),
  };
}

function cellFrom(element: Element): JSONContent {
  const align = /text-align:\s*(left|center|right)/i.exec(element.getAttribute("style") ?? "")?.[1];
  const colspan = Number(element.getAttribute("colspan") ?? 1);
  const rowspan = Number(element.getAttribute("rowspan") ?? 1);
  const attrs = {
    ...(align ? { align: align.toLowerCase() } : {}),
    ...(colspan > 1 ? { colspan } : {}),
    ...(rowspan > 1 ? { rowspan } : {}),
  };
  return withAttrs(
    { type: tagOf(element) === "th" ? "tableHeader" : "tableCell", content: blocksOrParagraph(element.childNodes) },
    attrs,
  );
}

function blockFrom(element: Element): JSONContent[] {
  const tag = tagOf(element);
  const attrs = readBlockAttrs(element);

  if (tag === "p") {
    return textblocks("paragraph", attrs, element.childNodes);
  }
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) {
    return textblocks("heading", { level: Number(heading[1]), ...attrs }, element.childNodes);
  }
  if (tag === "blockquote") {
    const note = element.getAttribute("data-note");
    return [withAttrs({ type: "blockquote", content: blocksOrParagraph(element.childNodes) }, { ...(note ? { note } : {}), ...attrs })];
  }
  if (tag === "pre") {
    const text = codeText(element);
    if (element.hasAttribute("data-raw")) {
      return [withAttrs({ type: "rawBlock", content: textNode(text) }, attrs)];
    }
    const code = element.querySelector("code");
    const language =
      element.getAttribute("data-language") ??
      /(?:^|\s)language-(\S+)/.exec(code?.className ?? "")?.[1] ??
      null;
    return [withAttrs({ type: "codeBlock", attrs: { language }, content: textNode(text) }, attrs)];
  }
  if (tag === "ul" || tag === "ol" || tag === "li") {
    const items = tag === "li" ? [element] : children(element, "li");
    const content = items.map(listItem);
    if (tag === "ol") {
      const start = Number(element.getAttribute("start") ?? 1) || 1;
      return content.length ? [withAttrs({ type: "orderedList", attrs: { start }, content }, attrs)] : [];
    }
    const tasks =
      element.hasAttribute("data-task-list") || content.some((item) => item.type === "taskItem");
    return content.length ? [withAttrs({ type: tasks ? "taskList" : "bulletList", content }, attrs)] : [];
  }
  if (tag === "table") {
    const rows = [...element.querySelectorAll("tr")]
      .filter((row) => row.closest("table") === element)
      .map((row) => ({ type: "tableRow", content: children(row, "th, td").map(cellFrom) }))
      .filter((row) => row.content.length);
    return rows.length ? [withAttrs({ type: "table", content: rows }, attrs)] : [];
  }
  if (tag === "hr") {
    return [withAttrs({ type: "horizontalRule" }, attrs)];
  }
  if (tag === "img") {
    const image = imageFrom(element);
    return image ? [image] : [];
  }
  if (tag === "figure") {
    if (element.hasAttribute("data-gallery")) {
      const images = [...element.querySelectorAll("img")]
        .map((img) => imageFrom(img.closest("figure[data-image]") ?? img))
        .filter((image): image is JSONContent => image !== null);
      return images.length ? [withAttrs({ type: "gallery", content: images }, attrs)] : [];
    }
    if (element.hasAttribute("data-image") || element.querySelector("img")) {
      const images = element.hasAttribute("data-image")
        ? [imageFrom(element)]
        : [...element.querySelectorAll("img")].map(imageFrom);
      return images.filter((image): image is JSONContent => image !== null);
    }
    return blocksFrom(element.childNodes);
  }
  if (tag === "div" && element.hasAttribute("data-embed")) {
    return [
      withAttrs(
        {
          type: "embed",
          attrs: {
            platform: element.getAttribute("data-platform") || "youtube",
            id: element.getAttribute("data-id") ?? "",
          },
        },
        attrs,
      ),
    ];
  }
  if ((tag === "div" && element.hasAttribute("data-collapsible")) || tag === "details") {
    const summary = children(element, "[data-collapsible-summary], summary")[0];
    const body = children(element, "[data-collapsible-content]")[0];
    const rest = body
      ? body.childNodes
      : [...element.childNodes].filter((node) => node !== summary);
    const open =
      tag === "details" ? element.hasAttribute("open") : element.getAttribute("data-open") !== "false";
    const summaryContent = summary ? textblocks("collapsibleSummary", {}, summary.childNodes)[0] : null;
    return [
      withAttrs(
        {
          type: "collapsible",
          attrs: { open },
          content: [
            summaryContent?.type === "collapsibleSummary" ? summaryContent : { type: "collapsibleSummary" },
            { type: "collapsibleContent", content: blocksOrParagraph(rest) },
          ],
        },
        attrs,
      ),
    ];
  }
  if (tag === "div" && element.hasAttribute("data-footnote")) {
    return [
      withAttrs(
        {
          type: "footnoteDef",
          attrs: { label: element.getAttribute("data-footnote") ?? "1" },
          content: blocksOrParagraph(element.childNodes),
        },
        attrs,
      ),
    ];
  }
  if (tag === "div" && element.hasAttribute("data-raw")) {
    return [withAttrs({ type: "rawBlock", content: textNode(codeText(element)) }, attrs)];
  }
  if (tag === "div" && ![...element.childNodes].some(isBlock)) {
    return significant([...element.childNodes]) ? textblocks("paragraph", attrs, element.childNodes) : [];
  }
  return blocksFrom(element.childNodes);
}

export function htmlToDoc(html: string): JSONContent {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  return { type: "doc", content: blocksOrParagraph(body.childNodes) };
}
