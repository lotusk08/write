import type { JSONContent } from "../editor/doc.ts";
import { writtenPin } from "../../shared/pin.ts";
import type { PostMeta } from "../../shared/types.ts";
import { ATTRIBUTES, NOTE_CLASSES, OLD_ATTRIBUTES, embedTag, isNoteType, pandocAttributes } from "../editor/blog.ts";
import { ENTITY, autolinkFor, bareLinks, entityText, escapeChars } from "./inline.ts";
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

function entityAt(text: string): boolean {
  const match = ENTITY.exec(text);
  return Boolean(match && entityText(match) !== null);
}

const IAL = new RegExp(`^${ATTRIBUTES}$`);
// kramdown's older form too, which the app reads as the list it holds: written as text, it stays text.
const ATTRIBUTE_LIST = new RegExp(`${ATTRIBUTES}|${OLD_ATTRIBUTES}`, "g");

function escapePlain(text: string, follower = ""): string {
  return text
    .split(/(\[\^[^\]\s]+\])/)
    .map((part, index) =>
      index % 2
        ? part
        : part
            .replace(/\\(?=[!-/:-@[-`{-~])/g, "\\\\")
            // Text that reads as an attribute list would give its attributes to the code, link or photo before it.
            .replace(ATTRIBUTE_LIST, (list) => `\\${list}`)
            .replace(/([`*_[\]|])/g, "\\$1")
            .replace(/&(?=#[xX]?[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]*;)/g, (amp, at, whole) =>
              entityAt(whole.slice(at)) ? "\\&" : amp,
            )
            .replace(/~{2,}/g, (run) => run.replace(/~/g, "\\~"))
            .replace(/<(?=([a-zA-Z/!?])?)/g, (bracket, next, at, whole) =>
              next || (at === whole.length - 1 && /^[a-zA-Z/!?]/.test(follower)) ? "\\<" : bracket,
            ),
    )
    .join("");
}

// A note's mark opening a line with a colon after it, `[^1]:`, would start the note's text instead.
const ANY_LINE = new RegExp(String.raw`^ {0,3}(?:(?:#{1,6}|[-+])(?=[ \t]|$)|>|${ATTRIBUTES}|-+[ \t]*$|\[\^[^\]\s]+\]:)`);
const FIRST_LINE = /^ {0,3}\d{1,9}[.)](?=[ \t]|$)/;
const LATER_LINE = /^ {0,3}(?:\d{1,9}[.)](?=[ \t]|$)|=+[ \t]*$)/;

function escapeLineStarts(written: string, opensLine = true): string {
  return written
    .split("\n")
    .map((line, index) => {
      if (index === 0 && !opensLine) {
        return line;
      }
      if (!ANY_LINE.test(line) && !(index === 0 ? FIRST_LINE : LATER_LINE).test(line)) {
        return line;
      }
      const at = /^ *\d*/.exec(line)![0].length;
      return `${line.slice(0, at)}\\${line.slice(at)}`;
    })
    .join("\n");
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

function delimit(text: string, open: string, close = open): string {
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return core ? `${lead}${open}${core}${close}${trail}` : text;
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
    const filepath = code.attrs?.filepath ? "{.path}" : "";
    out = `${fence}${padding}${text}${padding}${fence}${filepath}`;
  }

  let unbold = "";
  let last = "";
  for (const mark of [...marks].reverse()) {
    const inner = out;
    switch (mark.type) {
      case "bold":
        out = delimit(out, "**");
        break;
      case "italic":
        out = last === "bold" ? delimit(unbold, "*__", "__*") : delimit(out, "*");
        break;
      case "strike":
        out = delimit(out, "~~");
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
        const href = oneLine(String(mark.attrs?.href ?? ""));
        out = `[${out}](${balanced(href) ? href : `<${href}>`}${quotedTitle(mark.attrs?.title)})`;
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

function balanced(href: string): boolean {
  let depth = 0;
  for (const char of href.replace(/\\./g, "")) {
    depth += char === "(" ? 1 : char === ")" ? -1 : 0;
    if (depth < 0) {
      return false;
    }
  }
  return depth === 0 || /[<>\n]/.test(href);
}

/** An address kept to its line: a line end in it would close the link and leave the rest to be read as Markdown of its own. */
function oneLine(address: string): string {
  return address.replace(/[\r\n]/g, encodeURIComponent);
}


/** An attribute list as it is read back, `{.x}` (kramdown's `{: .x}` of an older draft as that), or nothing: anything else would be written as text of the post. */
function ialOf(value: unknown): string {
  const ial = value ? pandocAttributes(String(value)) : "";
  return IAL.test(ial) ? ial : "";
}

/** A footnote's label as it is read back, with no space or closing bracket in it. */
function footnoteLabel(value: unknown): string {
  return String(value ?? "").replace(/[\]\s]/g, "");
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
      rendered.push(bold ? delimit(inner, "*__", "__*") : wrap(inner, wrapper));
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
      rendered.push(applyMarks(`[^${footnoteLabel(node.attrs?.label)}]`, marks));
    } else {
      rendered.push(inline(node.content, options, linked));
    }
    index += 1;
  }
  return rendered
    .map((piece, at) => (bangs.has(at) && rendered[at + 1]?.startsWith("[") ? `${piece.slice(0, -1)}\\!` : piece))
    .map((piece, at, pieces) =>
      // A backslash ending one piece would escape what the next opens with, a mark or a line end: `C:\**Users**`.
      /(?<!\\)(?:\\\\)*\\$/.test(piece) && /^[!-/:-@[-`{-~\n]/.test(pieces[at + 1] ?? "") ? `${piece}\\` : piece,
    )
    .join("");
}

function quotedTitle(title: unknown): string {
  return title ? ` "${escapeChars(String(title).replace(/\s*\n\s*/g, " "), '"')}"` : "";
}

function image(node: JSONContent, options: SerializeOptions): string {
  const rawSrc = String(node.attrs?.src ?? "");
  const src = options.resolveImage ? options.resolveImage(rawSrc) : rawSrc;
  const alt = escapeChars(String(node.attrs?.alt ?? "").replace(/\s*\n\s*/g, " "), "[]`*_<~");
  return `![${alt}](${oneLine(src)}${quotedTitle(node.attrs?.title)})${ialOf(node.attrs?.ial)}`;
}

function fenced(info: string, body: string): string {
  const inner = Math.max(2, ...[...body.matchAll(/^[ \t]*(`{3,})/gm)].map((run) => run[1].length));
  const fence = "`".repeat(inner + 1);
  return `${fence}${info.replace(/[\r\n`]/g, "")}\n${body}\n${fence}`;
}

function galleryBlock(node: JSONContent, options: SerializeOptions): string {
  const photos = (node.content ?? []).filter((child) => child.type === "image");
  return fenced("gallery", photos.map((photo) => image(photo, options)).join("\n"));
}

/** A numbered list counting from anything but 1 cannot start under a paragraph: markdown reads it as more of the paragraph. */
function canHug(node: JSONContent, previous: JSONContent | undefined): boolean {
  return !(node.type === "orderedList" && Number(node.attrs?.start ?? 1) !== 1 && previous?.type === "paragraph");
}

function indentedBody(
  children: JSONContent[] | undefined,
  indent: string,
  options: SerializeOptions,
): string {
  return (children ?? []).reduce((text, child, position) => {
    const rendered = blocks([child], options).join("\n\n");
    const sticks = Boolean(child.attrs?.joinPrevious && child.attrs?.sameLine);
    // A paragraph that goes on in lines not indented to the item's text is written so, its first line indented.
    const piece = child.attrs?.lazy
      ? position === 0 || sticks
        ? rendered
        : indent + rendered
      : indentBlock(rendered, indent, position === 0 || sticks);
    if (position === 0) {
      return piece;
    }
    if (sticks) {
      return text + piece;
    }
    const hugs =
      (LIST_TYPES.has(child.type ?? "") || Boolean(child.attrs?.joinPrevious)) && canHug(child, children?.[position - 1]);
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
        .replace(/(?<!\\)\|/g, "\\|")
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
  if (!heading.some((cell) => cell.type === "tableHeader")) {
    return rows.map(pad).join("\n");
  }
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
  const text = (summaryNode?.content ?? []).map((child) => (child.type === "hardBreak" ? " " : (child.text ?? ""))).join("");
  const summary = escapeHtml(text.trim() || "Details");
  const body = blocks(contentNode?.content, options).join("\n\n");
  const open = node.attrs?.open ? " open" : "";
  return `<details${open}>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

const ENDS_WITH_IAL = new RegExp(`\\n${ATTRIBUTES}$`);

function blockIal(nodes: JSONContent[], index: number): string {
  if (nodes[index].attrs?.ialAbove) {
    return "";
  }
  return ialOf(nodes[index].attrs?.blockIal);
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
        // A paragraph of no-break spaces alone, a spacer, is written as the entity: the character reads back as a blank line.
        const spacer = written.includes("\u00a0") && !written.trim();
        out.push(spacer ? "&nbsp;" : escapeLineStarts(written, !(before && node.attrs?.sameLine)));
        break;
      }
      case "heading": {
        const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 6);
        // A run of `#` closing the text after a space would be read as the heading's optional closing run, and dropped.
        const text = inline(node.content, options).replace(/(^|[ \t])(#+)$/, (_, space: string, run: string) => space + run.replace(/#/g, "\\#"));
        out.push(
          level < 3 && text.includes("\n")
            ? `${text}\n${level === 1 ? "===" : "---"}`
            : `${"#".repeat(level)} ${text.replace(/\n/g, "<br>")}`,
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
        // A callout is named on its quote's first line, as GitHub writes its alerts, by the blog's name for it.
        const note = name ? `> [!${isNoteType(name) ? NOTE_CLASSES[name] : name}]\n` : "";
        out.push(note + quoted);
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
          `[^${footnoteLabel(node.attrs?.label)}]: ${indentedBody(node.content, "    ", options)}`,
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

    if (node.attrs?.ialAbove && ialOf(node.attrs?.blockIal) && out.length > start) {
      out[start] = `${ialOf(node.attrs.blockIal)}\n${out[start]}`;
    }

    if (node.attrs?.joinPrevious && out.length === start + 1 && start > 0 && canHug(node, nodes[index - 1])) {
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

// eslint-disable-next-line no-control-regex -- control characters are what this matches
const YAML_CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029\ufeff\ufffe\uffff]/;

// eslint-disable-next-line no-control-regex -- control characters are what this matches
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

/** A field kept raw, with the lines under it, taken out: a `moments` the toggle has since set must not be written twice. */
function withoutKey(lines: string[], key: string): string[] {
  let skipping = false;
  return lines.filter((line) => {
    if (/^\S/.test(line)) {
      skipping = line.startsWith(`${key}:`);
    }
    return !skipping;
  });
}

/**
 * A date the blog reads (`2026-10-11`, `2026-10-11 09:00 +0700`), written plain as the posts write it: the blog reads
 * its YAML with the core schema, where none of these is a timestamp, so quoting one only moved its line.
 */
const POST_DATE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)?(?: ?(?:Z|[+-]\d{2}:?\d{2}))?$/;

export function buildFrontMatter(meta: PostMeta): string {
  const lines = ["---", `title: ${yamlString(meta.title)}`];
  if (meta.description.trim()) {
    lines.push(`description: ${yamlString(meta.description)}`);
  }
  lines.push(`date: ${POST_DATE.test(meta.date) ? meta.date : yamlString(meta.date)}`);
  if (meta.lang?.trim()) {
    lines.push(`lang: ${yamlString(meta.lang)}`);
  }
  lines.push(...yamlList("tags", uniqueNames(meta.tags)));
  lines.push(`pin: ${writtenPin(meta.pin)}`, `toc: ${Boolean(meta.toc)}`);
  if (meta.cover?.path) {
    lines.push("image:", `  path: ${yamlString(meta.cover.path)}`);
    if (meta.cover.alt.trim()) {
      lines.push(`  alt: ${yamlString(meta.cover.alt)}`);
    }
    if (meta.cover.lqip?.trim()) {
      lines.push(`  lqip: ${yamlString(meta.cover.lqip)}`);
    }
  }
  const extra = typeof meta.moments === "boolean" ? withoutKey(meta.extra ?? [], "moments") : meta.extra;
  if (extra?.length) {
    lines.push(...extra);
    if (extra[extra.length - 1] === "") {
      lines.push("");
    }
  }
  if (typeof meta.moments === "boolean") {
    lines.push(`moments: ${meta.moments}`);
  }
  lines.push("---");
  return lines.join("\n");
}

export function buildPostFile(meta: PostMeta, doc: JSONContent, options: SerializeOptions = {}): string {
  return `${buildFrontMatter(meta)}\n${docToMarkdown(doc, options)}\n`;
}
