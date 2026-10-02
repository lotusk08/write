import type { JSONContent } from "@tiptap/core";
import type { PostMeta } from "../../shared/types.ts";
import { CENTER_ROW } from "../editor/extensions/blogFormat.ts";
import { embedTag } from "../editor/extensions/embed.ts";
import { autolinkFor, bareLinks } from "./inline.ts";
import { topicSlug } from "./topics.ts";

export interface SerializeOptions {
  resolveImage?: (src: string) => string;
}

type Mark = { type: string; attrs?: Record<string, unknown> };

const REF_MARKS = new Set(["bold", "italic", "strike", "underline", "highlight"]);
const DELIMITED = new Set(["bold", "italic", "strike"]);

function outside(mark: Mark): string[] {
  return String(mark.attrs?.within ?? "").split(" ").filter(Boolean);
}

function nesting(marks: Mark[]): Mark[] {
  const link = marks.find((mark) => mark.type === "link");
  const waiting = link ? [link, ...marks.filter((mark) => mark !== link)] : [...marks];
  const placed: Mark[] = [];
  while (waiting.length) {
    const free = waiting.findIndex((mark) => !waiting.some((other) => outside(mark).includes(other.type)));
    placed.push(...waiting.splice(Math.max(free, 0), 1));
  }
  return placed;
}

function marksOf(node: JSONContent): Mark[] {
  const marks = (node.marks as Mark[] | undefined) ?? [];
  if (node.type === "text") {
    return nesting(marks);
  }
  if (node.type === "hardBreak") {
    return nesting(marks.filter((mark) => mark.type !== "code" && mark.type !== "rawInline"));
  }
  if (node.type === "footnoteRef") {
    return marks.filter((mark) => REF_MARKS.has(mark.type));
  }
  return [];
}

function escapePlain(text: string, follower = ""): string {
  return text
    .split(/(\[\^[^\]\s]+\])/)
    .map((part, index) =>
      index % 2
        ? part
        : part
            .replace(/\\(?=[!-/:-@[-`{-~])/g, "\\\\")
            .replace(/([`*_[\]])/g, "\\$1")
            .replace(/~{2,}/g, (run) => run.replace(/~/g, "\\~"))
            .replace(/<(?=([a-zA-Z/!?])?)/g, (bracket, next, at, whole) =>
              next || (at === whole.length - 1 && /^[a-zA-Z/!?]/.test(follower)) ? "\\<" : bracket,
            ),
    )
    .join("");
}

function escapeText(text: string, linked: boolean): string {
  let out = "";
  let at = 0;
  for (const { start, end, inline } of linked ? [] : bareLinks(text)) {
    const after = inline ? end + /^\**[[\]<]?/.exec(text.slice(end))![0].length : end;
    out += escapePlain(text.slice(at, start), text[start]) + text.slice(start, after);
    at = after;
  }
  return out + escapePlain(text.slice(at));
}

function applyMarks(text: string, marks: Mark[] | undefined): string {
  if (!marks?.length || !text) {
    return text;
  }
  const code = marks.find((mark) => mark.type === "code");
  let out = text;
  if (code) {
    const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
    const fence = "`".repeat(longest + 1);
    const padding = /^`|`$|^[ \n][\s\S]+[ \n]$/.test(text) ? " " : "";
    const filepath = code.attrs?.filepath ? "{: .filepath}" : "";
    out = `${fence}${padding}${text}${padding}${fence}${filepath}`;
  }

  let unbold = "";
  let last = "";
  for (const mark of [...marks].reverse()) {
    const inner = out;
    switch (mark.type) {
      case "bold":
        out = `**${out}**`;
        break;
      case "italic":
        out = last === "bold" ? `*__${unbold}__*` : `*${out}*`;
        break;
      case "strike":
        out = `~~${out}~~`;
        break;
      case "underline":
        out = `<u>${out}</u>`;
        break;
      case "highlight":
        out = `<mark>${out}</mark>`;
        break;
      case "superscript":
        out = `<sup>${out}</sup>`;
        break;
      case "subscript":
        out = `<sub>${out}</sub>`;
        break;
      case "link": {
        const href = String(mark.attrs?.href ?? "");
        const title = mark.attrs?.title ? ` "${String(mark.attrs.title)}"` : "";
        out = `[${out}](${href}${title})`;
        break;
      }
      default:
        break;
    }
    if (mark.type !== "code" && mark.type !== "rawInline") {
      unbold = inner;
      last = mark.type;
    }
  }
  return out;
}

function nextLine(block: string, addition: string): string {
  const leadingBreak = /^[ \t]{2,}\n/.exec(addition);
  if (leadingBreak) {
    return block + addition;
  }
  return block.endsWith("\n") ? block + addition : `${block}\n${addition}`;
}

function withoutEdgeBreaks(
  nodes: JSONContent[] | undefined,
  keepLeading: boolean,
  keepTrailing: boolean,
): JSONContent[] | undefined {
  if (!nodes?.length) {
    return nodes;
  }
  const content = [...nodes];
  while (!keepTrailing && content[content.length - 1]?.type === "hardBreak") {
    content.pop();
  }
  while (!keepLeading && content[0]?.type === "hardBreak") {
    content.shift();
  }
  return content;
}

function captionContent(nodes: JSONContent[] | undefined): JSONContent[] | undefined {
  if (!nodes?.length) {
    return nodes;
  }
  let italic: Mark | null = null;
  return nodes.map((node) => {
    if (node.type === "text") {
      const marks = marksOf(node);
      italic = marks.some((mark) => mark.type === "code")
        ? null
        : (marks.find((mark) => mark.type === "italic") ?? null);
      return node;
    }
    if (node.type !== "footnoteRef") {
      italic = null;
      return node;
    }
    if (!italic) {
      return node;
    }
    return { ...node, marks: [...marksOf(node).filter((mark) => mark.type !== "italic"), italic] };
  });
}

function sameMark(a: Mark, b: Mark): boolean {
  return a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});
}

function wrap(text: string, mark: Mark): string {
  return applyMarks(text, [mark]);
}

function textNode(node: JSONContent, linked: boolean): string {
  const marks = marksOf(node);
  const raw = node.text ?? "";
  const verbatim = marks.some((mark) => mark.type === "code" || mark.type === "rawInline");
  const link = marks.length === 1 && marks[0].type === "link" ? marks[0] : null;
  if (link && !link.attrs?.title && autolinkFor(raw, String(link.attrs?.href ?? ""))) {
    return `<${raw}>`;
  }
  return applyMarks(verbatim ? raw : escapeText(raw, linked || marks.some((mark) => mark.type === "link")), marks);
}

function underBold(run: JSONContent[]): Mark | null {
  const bold = marksOf(run[0]).find((mark) => mark.type === "bold");
  return bold && run.every((part) => marksOf(part).some((mark) => sameMark(mark, bold))) ? bold : null;
}

function inline(nodes: JSONContent[] | undefined, options: SerializeOptions, linked = false): string {
  if (!nodes?.length) {
    return "";
  }
  const rendered: string[] = [];
  const bangs = new Set<number>();
  let index = 0;
  while (index < nodes.length) {
    const node = nodes[index];
    const marks = marksOf(node);
    let outer: Mark | null = null;
    let end = index + 1;
    for (const mark of marks) {
      const delimited = DELIMITED.has(mark.type);
      if (mark.type === "code" || mark.type === "rawInline" || (delimited && node.type === "hardBreak")) {
        continue;
      }
      let reach = index + 1;
      while (reach < nodes.length && marksOf(nodes[reach]).some((other) => sameMark(other, mark))) {
        reach += 1;
      }
      while (delimited && nodes[reach - 1].type === "hardBreak") {
        reach -= 1;
      }
      if (reach > end) {
        outer = mark;
        end = reach;
      }
    }
    if (outer) {
      const wrapper = outer;
      const bold = wrapper.type === "italic" ? underBold(nodes.slice(index, end)) : null;
      const run = nodes.slice(index, end).map((part) => ({
        ...part,
        marks: marksOf(part).filter((mark) => !sameMark(mark, wrapper) && !(bold && sameMark(mark, bold))),
      }));
      const inner = inline(run, options, linked || wrapper.type === "link");
      rendered.push(bold ? `*__${inner}__*` : wrap(inner, wrapper));
      index = end;
      continue;
    }
    if (node.type === "text") {
      rendered.push(textNode(node, linked));
      const raw = node.text ?? "";
      if (!marksOf(node).length && raw.endsWith("!") && (linked || !bareLinks(`${raw}[`).some(({ end }) => end >= raw.length))) {
        bangs.add(rendered.length - 1);
      }
    } else if (node.type === "hardBreak") {
      rendered.push("\n");
    } else if (node.type === "image") {
      rendered.push(image(node, options));
    } else if (node.type === "footnoteRef") {
      rendered.push(applyMarks(`[^${String(node.attrs?.label ?? "")}]`, marks));
    } else {
      rendered.push(inline(node.content, options, linked));
    }
    index += 1;
  }
  return rendered
    .map((piece, at) => (bangs.has(at) && rendered[at + 1]?.startsWith("[") ? `${piece.slice(0, -1)}\\!` : piece))
    .join("");
}

function image(node: JSONContent, options: SerializeOptions): string {
  const rawSrc = String(node.attrs?.src ?? "");
  const src = options.resolveImage ? options.resolveImage(rawSrc) : rawSrc;
  const alt = String(node.attrs?.alt ?? "").replace(/[[\]]/g, "");
  const title = node.attrs?.title ? ` "${String(node.attrs.title)}"` : "";
  const ial = node.attrs?.ial ? String(node.attrs.ial) : "";
  return `![${alt}](${src}${title})${ial}`;
}

function fenced(info: string, body: string): string {
  const inner = Math.max(2, ...[...body.matchAll(/^[ \t]*(`{3,})/gm)].map((run) => run[1].length));
  const fence = "`".repeat(inner + 1);
  return `${fence}${info}\n${body}\n${fence}`;
}

function galleryBlock(node: JSONContent, options: SerializeOptions): string {
  const kind = String(node.attrs?.kind ?? "deck");
  const photos = (node.content ?? []).filter((child) => child.type === "image");
  return fenced(`gallery ${kind}`, photos.map((photo) => image(photo, options)).join("\n"));
}

function indentedBody(
  children: JSONContent[] | undefined,
  indent: string,
  options: SerializeOptions,
): string {
  return (children ?? []).reduce((text, child, position) => {
    const rendered = blocks([child], options).join("\n\n");
    const sticks = Boolean(child.attrs?.joinPrevious && child.attrs?.sameLine);
    const piece = child.attrs?.lazy
      ? rendered
      : indentBlock(rendered, indent, position === 0 || sticks);
    if (position === 0) {
      return piece;
    }
    if (sticks) {
      return text + piece;
    }
    const hugs = LIST_TYPES.has(child.type ?? "") || Boolean(child.attrs?.joinPrevious);
    return `${text}${hugs ? "\n" : "\n\n"}${piece}`;
  }, "");
}

function indentBlock(block: string, indent: string, skipFirst: boolean): string {
  return block
    .split("\n")
    .map((line, index) => ((skipFirst && index === 0) || line === "" ? line : indent + line))
    .join("\n");
}

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

function listBlock(node: JSONContent, options: SerializeOptions, ordered: boolean): string {
  const items = node.content ?? [];
  const start = Number(node.attrs?.start ?? 1);
  return items
    .map((item, index) => {
      const marker = ordered ? `${start + index}. ` : "- ";
      const checkbox =
        item.type === "taskItem" ? (item.attrs?.checked ? "[x] " : "[ ] ") : "";
      const indent = " ".repeat(marker.length);
      return marker + checkbox + indentedBody(item.content, indent, options);
    })
    .join("\n");
}

function tableBlock(node: JSONContent, options: SerializeOptions): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      blocks(cell.content, options)
        .join(" ")
        .replace(/\n+/g, " ")
        .replace(/\|/g, "\\|")
        .trim(),
    ),
  );
  if (!rows.length) {
    return "";
  }
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
  const [head, ...body] = rows;
  const heading = node.content?.[0]?.content ?? [];
  const divider = Array.from({ length: width }, (_, i) => {
    const align = heading[i]?.attrs?.align;
    if (align === "center") {
      return ":---:";
    }
    return align === "right" ? "---:" : align === "left" ? ":---" : "---";
  });
  return [pad(head), `| ${divider.join(" | ")} |`, ...body.map(pad)].join("\n");
}

function collapsibleBlock(node: JSONContent, options: SerializeOptions): string {
  const summaryNode = node.content?.find((child) => child.type === "collapsibleSummary");
  const contentNode = node.content?.find((child) => child.type === "collapsibleContent");
  const summary = inline(summaryNode?.content, options).trim() || "Details";
  const body = blocks(contentNode?.content, options).join("\n\n");
  const open = node.attrs?.open ? " open" : "";
  return `<details${open}>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

const ENDS_WITH_IAL = /\n\{:[^}\n]*\}$/;

function joinsRow(nodes: JSONContent[], index: number): boolean {
  return (
    nodes[index]?.type === "image" &&
    Boolean(nodes[index].attrs?.joinPrevious) &&
    nodes[index - 1]?.type === "image"
  );
}

function blockIal(nodes: JSONContent[], index: number): string {
  if (nodes[index].attrs?.ialAbove) {
    return "";
  }
  const own = nodes[index].attrs?.blockIal ? String(nodes[index].attrs.blockIal) : "";
  if (!joinsRow(nodes, index) && !joinsRow(nodes, index + 1)) {
    return own;
  }
  if (joinsRow(nodes, index + 1)) {
    return own === CENTER_ROW ? "" : own;
  }
  if (own) {
    return own;
  }
  let first = index;
  while (joinsRow(nodes, first)) {
    first -= 1;
  }
  const run = nodes.slice(first, index + 1);
  if (run.some((image) => image.attrs?.ialAbove)) {
    return "";
  }
  return run.some((image) => image.attrs?.blockIal === CENTER_ROW) ? CENTER_ROW : "";
}

function blocks(nodes: JSONContent[] | undefined, options: SerializeOptions): string[] {
  if (!nodes?.length) {
    return [];
  }
  const out: string[] = [];

  for (const [index, node] of nodes.entries()) {
    const start = out.length;
    switch (node.type) {
      case "paragraph": {
        const after = Boolean(nodes[index + 1]?.attrs?.joinPrevious);
        const before = Boolean(node.attrs?.joinPrevious);
        const content = withoutEdgeBreaks(node.content, before, after);
        const caption = before && nodes[index - 1]?.type === "image";
        const written = inline(caption ? captionContent(content) : content, options);
        out.push(before && node.attrs?.sameLine ? written.replace(/\n>/g, "\n\\>") : written.replace(/^>/gm, "\\>"));
        break;
      }
      case "heading": {
        const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 6);
        const text = inline(node.content, options);
        out.push(
          level < 3 && text.includes("\n")
            ? `${text}\n${level === 1 ? "===" : "---"}`
            : `${"#".repeat(level)} ${text}`,
        );
        break;
      }
      case "blockquote": {
        const inner = blocks(node.content, options).join("\n\n");
        const quoted = inner
          .split("\n")
          .map((line) => (line ? `> ${line}` : ">"))
          .join("\n");
        const name = node.attrs?.note ? String(node.attrs.note) : "";
        const note = name ? `\n{: ${name === "author" ? ".author" : `.note-${name}`} }` : "";
        out.push(quoted + note);
        break;
      }
      case "bulletList":
        out.push(listBlock(node, options, false));
        break;
      case "taskList":
        out.push(listBlock(node, options, false));
        break;
      case "orderedList":
        out.push(listBlock(node, options, true));
        break;
      case "codeBlock": {
        const language = String(node.attrs?.language ?? "");
        const code = (node.content ?? []).map((child) => child.text ?? "").join("");
        out.push(fenced(language, code));
        break;
      }
      case "gallery":
        out.push(galleryBlock(node, options));
        break;
      case "embed":
        out.push(embedTag(String(node.attrs?.platform ?? "youtube"), String(node.attrs?.id ?? "")));
        break;
      case "rawBlock":
        out.push((node.content ?? []).map((child) => child.text ?? "").join(""));
        break;
      case "horizontalRule":
        out.push("---");
        break;
      case "image":
        out.push(image(node, options));
        break;
      case "table":
        out.push(tableBlock(node, options));
        break;
      case "collapsible":
        out.push(collapsibleBlock(node, options));
        break;
      case "footnoteDef":
        out.push(
          `[^${String(node.attrs?.label ?? "")}]: ${indentedBody(node.content, "    ", options)}`,
        );
        break;
      case "listItem":
      case "taskItem":
      case "collapsibleContent":
        out.push(...blocks(node.content, options));
        break;
      default:
        if (node.content) {
          out.push(...blocks(node.content, options));
        }
        break;
    }

    if (node.attrs?.ialAbove && node.attrs?.blockIal && out.length > start) {
      out[start] = `${String(node.attrs.blockIal)}\n${out[start]}`;
    }

    if (node.attrs?.joinPrevious && out.length === start + 1 && start > 0) {
      const piece = out.pop() ?? "";
      if (piece) {
        out[start - 1] =
          node.attrs?.sameLine && !ENDS_WITH_IAL.test(out[start - 1])
            ? out[start - 1] + piece
            : nextLine(out[start - 1], piece);
      }
    }

    const ial = blockIal(nodes, index);
    if (ial && out.length) {
      out[out.length - 1] = nextLine(out[out.length - 1], ial);
    }
  }

  return out.filter((block) => block !== undefined);
}

export function docToMarkdown(doc: JSONContent, options: SerializeOptions = {}): string {
  return blocks(doc.content, options)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function docToPlainText(doc: JSONContent): string {
  const parts: string[] = [];
  const walk = (node: JSONContent) => {
    if (node.text) {
      parts.push(node.text);
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  return parts.join(" ");
}

const YAML_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}$|^\d{4}-\d{1,2}-\d{1,2}(?:[Tt]|[ \t]+)\d{1,2}:\d{2}:\d{2}(?:\.\d*)?(?:[ \t]*(?:Z|[-+]\d{1,2}(?::\d{2})?))?$/;

const YAML_NUMBER = /^[-+]?(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][-+]?\d+)?$|^[-+]?0[xob][0-9a-fA-F_]+$|^[-+]?\.(?:inf|Inf|INF)$|^\.(?:nan|NaN|NAN)$/;

const YAML_BOOL_OR_NULL = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL|~)$/;

const YAML_CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029\ufeff\ufffe\uffff]/;

const YAML_ESCAPED = /[\\"\x00-\x1f\x7f-\x9f\u2028\u2029\ufeff\ufffe\uffff]/g;

const YAML_ESCAPES: Record<string, string> = { "\\": "\\\\", '"': '\\"', "\n": "\\n", "\t": "\\t", "\r": "\\r" };

function yamlString(value: string): string {
  const plainIsSafe =
    value !== "" &&
    value === value.trim() &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) &&
    !/:\s|\s#/.test(value) &&
    !YAML_CONTROL.test(value) &&
    !value.endsWith(":") &&
    !YAML_TIMESTAMP.test(value) &&
    !YAML_NUMBER.test(value) &&
    !YAML_BOOL_OR_NULL.test(value);
  if (value === "") {
    return "''";
  }
  if (plainIsSafe) {
    return value;
  }
  const escaped = value.replace(
    YAML_ESCAPED,
    (char) => YAML_ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `"${escaped}"`;
}

export function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = topicSlug(value);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function yamlList(key: string, values: string[]): string[] {
  if (values.length === 0) {
    return [`${key}: []`];
  }
  return [`${key}:`, ...values.map((value) => `  - ${yamlString(value)}`)];
}

export function buildFrontMatter(meta: PostMeta): string {
  const lines = ["---", `title: ${yamlString(meta.title)}`];
  if (meta.description.trim()) {
    lines.push(`description: ${yamlString(meta.description)}`);
  }
  lines.push(`date: ${yamlString(meta.date)}`);
  if (meta.lang?.trim()) {
    lines.push(`lang: ${yamlString(meta.lang)}`);
  }
  lines.push(...yamlList("tags", uniqueNames(meta.tags)));
  lines.push(`pin: ${Boolean(meta.pin)}`, `toc: ${Boolean(meta.toc)}`);
  if (meta.cover?.path) {
    lines.push("image:", `  path: ${yamlString(meta.cover.path)}`);
    if (meta.cover.alt.trim()) {
      lines.push(`  alt: ${yamlString(meta.cover.alt)}`);
    }
    if (meta.cover.lqip?.trim()) {
      lines.push(`  lqip: ${yamlString(meta.cover.lqip)}`);
    }
  }
  if (meta.extra?.length) {
    lines.push(...meta.extra);
    if (meta.extra[meta.extra.length - 1] === "") {
      lines.push("");
    }
  }
  lines.push("---");
  return lines.join("\n");
}

export function buildPostFile(meta: PostMeta, doc: JSONContent, options: SerializeOptions = {}): string {
  return `${buildFrontMatter(meta)}\n${docToMarkdown(doc, options)}\n`;
}
