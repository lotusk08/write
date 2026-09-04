import type { JSONContent } from "@tiptap/core";
import type { PostMeta } from "../../shared/types.ts";
import { EMBED_LIQUID, EMBED_TAG, embedPlatform } from "../editor/extensions/embed.ts";

type Mark = { type: string; attrs?: Record<string, unknown> };

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[^\S\n]*(?:\r?\n|$)/;

// Trailing spaces on the last line are kept. markdown-it trims a paragraph of
// its own, so writing them back changes nothing there — but where an attribute
// list is lifted off the end of one, the space under it is left showing, and
// dropping it here is the one place that would not come back the same.
function trimAscii(value: string): string {
  return value.replace(/^[ \t\n]+/, "").replace(/\n[ \t\n]*$/, "");
}

function scalar(raw: string): string {
  const value = raw.trim();
  if (/^"[\s\S]*"$/.test(value)) {
    return value.slice(1, -1).replace(/\\(["\\/])/g, "$1").replace(/\\n/g, "\n");
  }
  if (/^'[\s\S]*'$/.test(value)) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (/^(null|~)$/i.test(value)) {
    return "";
  }
  return value;
}

function boolean(raw: string): boolean {
  return /^(true|yes|on)$/i.test(raw.trim());
}

export function parseFrontMatter(yaml: string): Partial<PostMeta> {
  const meta: Partial<PostMeta> = {};
  const lines = yaml.split(/\r?\n/);
  let cover: PostMeta["cover"] = null;
  const extra: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const start = i;
    const match = /^([A-Za-z_][\w-]*):[^\S\n]*(.*)$/.exec(lines[i]);
    if (!match) {
      continue;
    }
    const key = match[1];
    let value = match[2].trim();

    const items: string[] = [];
    if (!value) {
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        items.push(scalar(lines[++i].replace(/^\s+-\s+/, "")));
      }
      if (key === "image") {
        const nested: Record<string, string> = {};
        while (i + 1 < lines.length && /^\s+[A-Za-z_][\w-]*:/.test(lines[i + 1])) {
          const inner = /^\s+([A-Za-z_][\w-]*):[^\S\n]*(.*)$/.exec(lines[++i]);
          if (inner) {
            nested[inner[1]] = scalar(inner[2]);
          }
        }
        if (nested.path) {
          cover = {
            path: nested.path,
            alt: nested.alt ?? "",
            ...(nested.lqip ? { lqip: nested.lqip } : {}),
          };
        }
        continue;
      }
    } else if (/^\[.*\]$/.test(value)) {
      items.push(
        ...value
          .slice(1, -1)
          .split(",")
          .map(scalar)
          .filter(Boolean),
      );
      value = "";
    }

    switch (key) {
      case "title":
      case "description":
      case "author":
        meta[key] = scalar(value);
        break;
      case "date":
        meta.date = scalar(value);
        break;
      case "categories":
      case "tags":
        meta[key] = value ? [scalar(value)] : items;
        break;
      case "pin":
      case "toc":
        meta[key] = boolean(value);
        break;
      case "math":
      case "mermaid":
      case "chart":
      case "render_with_liquid":
        break;
      case "image":
        if (value) {
          cover = { path: scalar(value), alt: "" };
        }
        break;
      default:
        extra.push(...lines.slice(start, i + 1));
        break;
    }
  }

  if (cover) {
    meta.cover = cover;
  }
  if (extra.length) {
    meta.extra = extra;
  }
  return meta;
}

function text(value: string, marks: Mark[]): JSONContent {
  return marks.length ? { type: "text", text: value, marks } : { type: "text", text: value };
}

const IMAGE = /^!\[([^\]]*)\]\(/;
const LINK = /^\[((?:[^[\]\\]|\\.)*)\]\(/;
const FOOTNOTE_REF = /^\[\^([^\]\s]+)\]/;
const TAG = /^<(u|mark|sup|sub)>([\s\S]*?)<\/\1>/;

// Where the address opened at `from` closes. Parentheses inside it balance, as
// markdown-it balances them: a link whose URL carries a pair of its own is not
// cut at the first one, which used to drop everything past it into the text.
function addressEnd(source: string, from: number): number {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i += 1;
    } else if (char === "\n") {
      return -1;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      if (!depth) {
        return i;
      }
      depth -= 1;
    }
  }
  return -1;
}

interface Target {
  href: string;
  title?: string;
  end: number;
}

function linkTarget(rest: string, from: number): Target | null {
  const close = addressEnd(rest, from);
  if (close === -1) {
    return null;
  }
  let inner = rest.slice(from, close);
  const quoted = /\s+"([^"]*)"\s*$/.exec(inner);
  const title = quoted?.[1];
  if (quoted) {
    inner = inner.slice(0, quoted.index);
  }
  return { href: inner.trim(), ...(title ? { title } : {}), end: close + 1 };
}

// Where the emphasis opened at the head of `rest` closes. A code span and a
// link's address are stepped over whole: the asterisks inside a URL are part of
// it, and reading one as the closing mark loses the link the next time round.
function emphasisEnd(rest: string, opening: string): number {
  // The mark has to close on something: the earliest it can is one character in.
  let i = opening.length + 1;
  while (i < rest.length) {
    if (rest[i] === "\\") {
      i += 2;
      continue;
    }
    if (rest[i] === "`") {
      const code = /^(`+)[\s\S]*?\1(?!`)/.exec(rest.slice(i));
      if (code) {
        i += code[0].length;
        continue;
      }
    }
    if (rest[i] === "]" && rest[i + 1] === "(") {
      const close = addressEnd(rest, i + 2);
      if (close !== -1) {
        i = close + 1;
        continue;
      }
    }
    if (rest.startsWith(opening, i) && /\S/.test(rest[i - 1] ?? "")) {
      return i;
    }
    i += 1;
  }
  return -1;
}

export function parseInline(source: string, marks: Mark[] = []): JSONContent[] {
  const out: JSONContent[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer) {
      out.push(text(buffer, marks));
      buffer = "";
    }
  };

  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const char = source[i];

    if (char === "\\" && i + 1 < source.length) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }
    const wrap = /^[^\S\n]*\n/.exec(rest);
    if (wrap) {
      flush();
      out.push({ type: "hardBreak" });
      i += wrap[0].length;
      continue;
    }
    if (char === "`") {
      const code = /^(`+)([\s\S]*?)\1(?!`)/.exec(rest);
      if (code) {
        flush();
        const tagged = /^\{:\s*\.filepath\s*\}/.exec(rest.slice(code[0].length));
        out.push(
          text(code[2].replace(/^ (.*) $/, "$1"), [
            ...marks,
            { type: "code", ...(tagged ? { attrs: { filepath: true } } : {}) },
          ]),
        );
        i += code[0].length + (tagged?.[0].length ?? 0);
        continue;
      }
    }
    if (char === "!") {
      const image = IMAGE.exec(rest);
      const target = image ? linkTarget(rest, image[0].length) : null;
      if (image && target) {
        flush();
        out.push({
          type: "image",
          attrs: { src: target.href, alt: image[1], title: target.title ?? null },
        });
        i += target.end;
        continue;
      }
    }
    if (char === "[") {
      const footnote = FOOTNOTE_REF.exec(rest);
      if (footnote) {
        flush();
        out.push({
          type: "footnoteRef",
          attrs: { label: footnote[1] },
          ...(marks.length ? { marks } : {}),
        });
        i += footnote[0].length;
        continue;
      }
      const link = LINK.exec(rest);
      const target = link ? linkTarget(rest, link[0].length) : null;
      if (link && target) {
        flush();
        const attrs: Record<string, unknown> = { href: target.href };
        if (target.title) {
          attrs.title = target.title;
        }
        out.push(...parseInline(link[1], [...marks, { type: "link", attrs }]));
        i += target.end;
        continue;
      }
    }
    if (char === "<") {
      const tag = TAG.exec(rest);
      if (tag) {
        flush();
        const mark = { u: "underline", mark: "highlight", sup: "superscript", sub: "subscript" }[tag[1]] as string;
        out.push(...parseInline(tag[2], [...marks, { type: mark }]));
        i += tag[0].length;
        continue;
      }
    }
    if (char === "*" || char === "_" || char === "~") {
      const opening =
        /^(\*\*\*|___)(?=\S)/.exec(rest)?.[1] ??
        /^(\*\*|__)(?=\S)/.exec(rest)?.[1] ??
        /^(~~)(?=\S)/.exec(rest)?.[1] ??
        /^(\*|_)(?=\S)/.exec(rest)?.[1];
      const close = opening ? emphasisEnd(rest, opening) : -1;
      const underscore = opening?.startsWith("_");
      const boundary = !underscore || !/\w/.test(source[i - 1] ?? "");
      if (opening && close > 0 && boundary) {
        const added =
          opening === "~~"
            ? [{ type: "strike" }]
            : opening.length === 3
              ? [{ type: "bold" }, { type: "italic" }]
              : opening.length === 2
                ? [{ type: "bold" }]
                : [{ type: "italic" }];
        flush();
        out.push(...parseInline(rest.slice(opening.length, close), [...marks, ...added]));
        i += close + opening.length;
        continue;
      }
    }

    buffer += char;
    i += 1;
  }

  flush();
  return out;
}

function trimRun(nodes: JSONContent[]): JSONContent[] {
  const out = [...nodes];
  while (out[0]?.type === "hardBreak") {
    out.shift();
  }
  while (out[out.length - 1]?.type === "hardBreak") {
    out.pop();
  }
  return out;
}

const IAL = /^\{:[^}\n]*\}/;

function blocksFromInline(nodes: JSONContent[]): JSONContent[] {
  if (!nodes.some((node) => node.type === "image")) {
    const only = trimRun(nodes);
    return [only.length ? { type: "paragraph", content: only } : { type: "paragraph" }];
  }

  const out: JSONContent[] = [];
  const carriesOn: boolean[] = [];
  let run: JSONContent[] = [];
  const flush = () => {
    const sameLine = run.length > 0 && run[0]?.type !== "hardBreak";
    const trimmed = trimRun(run);
    if (trimmed.length) {
      out.push({ type: "paragraph", content: trimmed });
      carriesOn.push(sameLine);
    }
    run = [];
  };

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type !== "image") {
      run.push(node);
      continue;
    }
    const sameLine = run.length > 0 && run[run.length - 1]?.type !== "hardBreak";
    flush();
    const next = nodes[i + 1];
    const attributes = next?.type === "text" && !next.marks?.length ? IAL.exec(next.text ?? "") : null;
    if (attributes && next) {
      node.attrs = { ...node.attrs, ial: attributes[0] };
      const rest = (next.text ?? "").slice(attributes[0].length);
      if (rest) {
        nodes[i + 1] = { ...next, text: rest };
      } else {
        i += 1;
      }
    }
    out.push(node);
    carriesOn.push(sameLine);
  }

  flush();
  return out.map((block, index) =>
    index === 0
      ? block
      : {
          ...block,
          attrs: {
            ...block.attrs,
            joinPrevious: true,
            ...(carriesOn[index] ? { sameLine: true } : {}),
          },
        },
  );
}

function paragraph(source: string): JSONContent {
  const content = parseInline(source.trim());
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

const FENCE = /^(\s*)(```+|~~~+)\s*([\w+-]*)\s*$/;
const MATH = /^\s*\$\$\s*$/;
const LIQUID = /^\{%[\s\S]*%\}$/;
const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:[^\S\n]*/;
const DESCRIPTION = /^:\s+\S/;
const HTML_BLOCK = /^\s*<(?:\/?[a-zA-Z][\w-]*(?:\s[^>]*)?>|!--)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const LIST_START = /^ {0,3}(?:[-*+]|\d+[.)])\s+/;
const NOTE = /^\{:\s*\.(?:note-)?(tip|info|important|warning|danger|author)\s*\}\s*$/;
const BLOCK_IAL = /^\{:[^}\n]*\}\s*$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

// An attribute list closes the block above it only when nothing carries the
// paragraph on: with a line of text under it, markdown-it reads it as one more
// line of that paragraph, and the classes in it are never applied.
function ialClosesBlock(lines: string[], index: number): boolean {
  const next = lines[index + 1];
  return next === undefined || !next.trim() || isBlockStart(next);
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  return BLOCK_IAL.test(line) ? ialClosesBlock(lines, index) : isBlockStart(line);
}

function isBlockStart(line: string): boolean {
  return (
    !line.trim() ||
    HEADING.test(line) ||
    RULE.test(line) ||
    FENCE.test(line) ||
    MATH.test(line) ||
    HTML_BLOCK.test(line) ||
    LIQUID.test(line.trim()) ||
    FOOTNOTE_DEF.test(line) ||
    LIST_START.test(line) ||
    NOTE.test(line) ||
    BLOCK_IAL.test(line) ||
    line.trimStart().startsWith(">") ||
    line.trimStart().startsWith("<details") ||
    line.trimStart().startsWith("|")
  );
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function alignments(divider: string): (string | null)[] {
  return splitRow(divider).map((rule) => {
    const left = rule.startsWith(":");
    const right = rule.endsWith(":");
    if (left && right) {
      return "center";
    }
    return right ? "right" : left ? "left" : null;
  });
}

function cells(row: string[], header: boolean, align: (string | null)[]): JSONContent {
  return {
    type: "tableRow",
    content: row.map((cell, column) => ({
      type: header ? "tableHeader" : "tableCell",
      ...(align[column] ? { attrs: { align: align[column] } } : {}),
      content: [paragraph(cell)],
    })),
  };
}

function parseBlocks(lines: string[]): JSONContent[] {
  const out: JSONContent[] = [];
  let i = 0;
  let pending: string | null = null;
  let pendingAt = 0;

  const settle = () => {
    if (pending !== null && out.length > pendingAt) {
      out[pendingAt].attrs = { ...out[pendingAt].attrs, blockIal: pending };
      pending = null;
    }
  };

  while (i < lines.length) {
    settle();
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Indented, it is not an attribute list at all: markdown-it matches one
    // only at the head of its line, and reads the rest as text.
    if (BLOCK_IAL.test(line)) {
      const value = line.trim();
      if (out.length && lines[i - 1]?.trim()) {
        out[out.length - 1].attrs = { ...out[out.length - 1].attrs, blockIal: value };
      } else {
        pending = value;
        pendingAt = out.length;
      }
      i += 1;
      continue;
    }

    if (MATH.test(line)) {
      const tex: string[] = [];
      i += 1;
      while (i < lines.length && !MATH.test(lines[i])) {
        tex.push(lines[i]);
        i += 1;
      }
      i += 1;
      const source = tex.join("\n").trim();
      out.push({
        type: "mathBlock",
        ...(source ? { content: [{ type: "text", text: source }] } : {}),
      });
      continue;
    }

    if (LIQUID.test(line.trim()) || EMBED_TAG.test(line.trim())) {
      const trimmed = line.trim();
      const tag = EMBED_TAG.exec(trimmed) ?? EMBED_LIQUID.exec(trimmed);
      const platform = tag ? embedPlatform(tag[1]) : null;
      const joins = out.length > 0 && Boolean(lines[i - 1]?.trim());
      const attrs = joins ? { joinPrevious: true } : {};
      out.push(
        platform && tag
          ? { type: "embed", attrs: { platform, id: tag[3], ...attrs } }
          : {
              type: "rawBlock",
              attrs,
              content: [{ type: "text", text: trimmed }],
            },
      );
      i += 1;
      continue;
    }

    if (HTML_BLOCK.test(line) || DESCRIPTION.test(lines[i + 1] ?? "")) {
      const verbatim: string[] = [];
      while (i < lines.length && lines[i].trim()) {
        verbatim.push(lines[i]);
        i += 1;
      }
      out.push({ type: "rawBlock", content: [{ type: "text", text: verbatim.join("\n") }] });
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s*${fence[2][0]}{3,}\\s*$`).test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push({
        type: "codeBlock",
        attrs: { language: fence[3] || null },
        ...(code.length ? { content: [{ type: "text", text: code.join("\n") }] } : {}),
      });
      continue;
    }

    if (line.trimStart().startsWith("<details")) {
      const body: string[] = [];
      const open = !/\bopen\s*=?\s*"?(false)"?/.test(line) && /\bopen\b/.test(line);
      i += 1;
      let depth = 1;
      while (i < lines.length && depth > 0) {
        if (lines[i].includes("<details")) {
          depth += 1;
        }
        if (lines[i].includes("</details>")) {
          depth -= 1;
          if (depth === 0) {
            break;
          }
        }
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      const summaryLine = body.findIndex((entry) => entry.includes("<summary"));
      const summary =
        summaryLine === -1
          ? "Details"
          : /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(body[summaryLine])?.[1]?.trim() || "Details";
      if (summaryLine !== -1) {
        body.splice(summaryLine, 1);
      }
      out.push({
        type: "collapsible",
        attrs: { open },
        content: [
          { type: "collapsibleSummary", content: parseInline(summary) },
          { type: "collapsibleContent", content: blocksOrEmpty(body) },
        ],
      });
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        quoted.push(lines[i].trimStart().replace(/^>\s?/, ""));
        i += 1;
      }
      // markdown-it carries an open paragraph past the `>`, but only while the
      // quote's last line held one, and only as far as the next block.
      if (quoted[quoted.length - 1]?.trim()) {
        while (i < lines.length && !startsBlock(lines, i)) {
          quoted.push(lines[i]);
          i += 1;
        }
      }
      let note: string | null = null;
      const attribute = i < lines.length ? NOTE.exec(lines[i].trim()) : null;
      if (attribute) {
        note = attribute[1];
        i += 1;
      }
      out.push({
        type: "blockquote",
        attrs: { note },
        content: blocksOrEmpty(quoted),
      });
      continue;
    }

    if (line.trimStart().startsWith("|") && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const header = splitRow(line);
      const align = alignments(lines[i + 1]);
      i += 2;
      const rows: JSONContent[] = [cells(header, true, align)];
      while (i < lines.length && lines[i].trimStart().startsWith("|")) {
        rows.push(cells(splitRow(lines[i]), false, align));
        i += 1;
      }
      out.push({ type: "table", content: rows });
      continue;
    }

    const footnote = FOOTNOTE_DEF.exec(line);
    if (footnote) {
      const body: string[] = [line.slice(footnote[0].length)];
      i += 1;
      while (i < lines.length) {
        const next = lines[i];
        if (!next.trim()) {
          if (/^ {4}\S/.test(lines[i + 1] ?? "")) {
            body.push("");
            i += 1;
            continue;
          }
          break;
        }
        if (!/^ {4}/.test(next)) {
          break;
        }
        body.push(next.slice(4));
        i += 1;
      }
      out.push({ type: "footnoteDef", attrs: { label: footnote[1] }, content: blocksOrEmpty(body) });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      out.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: parseInline(heading[2]),
      });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      out.push({ type: "horizontalRule" });
      i += 1;
      continue;
    }

    const marker = LIST_START.test(line) ? (BULLET.exec(line) ?? ORDERED.exec(line)) : null;
    if (marker) {
      const [list, next] = parseList(lines, i, marker[1].length);
      if (next > i) {
        out.push(list);
        i = next;
        continue;
      }
    }

    const buffer: string[] = [line];
    i += 1;
    while (i < lines.length && !startsBlock(lines, i)) {
      buffer.push(lines[i]);
      i += 1;
    }
    out.push(...blocksFromInline(parseInline(trimAscii(buffer.join("\n")))));
  }

  settle();
  return rowAttributes(out);
}

function rowAttributes(blocks: JSONContent[]): JSONContent[] {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== "image" || !blocks[i].attrs?.blockIal) {
      continue;
    }
    let last = i;
    while (blocks[last + 1]?.type === "image" && blocks[last + 1].attrs?.joinPrevious) {
      last += 1;
    }
    if (last !== i) {
      blocks[last].attrs = { ...blocks[last].attrs, blockIal: blocks[i].attrs!.blockIal };
      blocks[i].attrs = { ...blocks[i].attrs, blockIal: null };
    }
  }
  return blocks;
}

function blocksOrEmpty(lines: string[]): JSONContent[] {
  const parsed = parseBlocks(lines);
  return parsed.length ? parsed : [{ type: "paragraph" }];
}

const TASK = /^\[([ xX])\]\s+(.*)$/;

function parseList(lines: string[], start: number, indent: number): [JSONContent, number] {
  const items: JSONContent[] = [];
  let ordered = false;
  let startAt = 1;
  let tasks = false;
  let i = start;
  // Where the last item's own text began. A marker indented that far belongs
  // to the item — it is a list inside it — and anything less deep is the next
  // item of this one, however it happens to be indented.
  let content = indent + 1;

  while (i < lines.length) {
    const bullet = BULLET.exec(lines[i]);
    const numbered = ORDERED.exec(lines[i]);
    const match = bullet ?? numbered;
    if (!match || match[1].length < indent) {
      break;
    }
    if (match[1].length >= content) {
      break;
    }
    if (items.length === 0) {
      ordered = Boolean(numbered);
      startAt = numbered ? Number(numbered[2]) : 1;
    } else if (Boolean(numbered) !== ordered) {
      break;
    }

    const marker = match[0].length - match[3].length;
    content = marker;
    const body: string[] = [];
    const task = TASK.exec(match[3]);
    if (items.length === 0 && task) {
      tasks = true;
    }
    body.push(task ? task[2] : match[3]);
    i += 1;

    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim()) {
        const following = lines[i + 1] ?? "";
        if (following.trim() && /^\s+/.test(following) && following.search(/\S/) >= marker) {
          body.push("");
          i += 1;
          continue;
        }
        break;
      }
      if (next.search(/\S/) >= marker) {
        body.push(next.slice(marker));
        i += 1;
        continue;
      }
      if (!isBlockStart(next)) {
        body.push(next);
        i += 1;
        continue;
      }
      break;
    }

    items.push({
      type: tasks ? "taskItem" : "listItem",
      ...(tasks ? { attrs: { checked: task ? task[1].toLowerCase() === "x" : false } } : {}),
      content: blocksOrEmpty(body),
    });
  }

  const type = tasks ? "taskList" : ordered ? "orderedList" : "bulletList";
  return [
    {
      type,
      ...(ordered && !tasks ? { attrs: { start: startAt } } : {}),
      content: items,
    },
    i,
  ];
}

function expandTabs(markdown: string): string {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced || !line.startsWith("\t")) {
        return line;
      }
      return line.replace(/^[\t ]+/, (indent) => {
        let width = 0;
        for (const character of indent) {
          width = character === "\t" ? width + 4 - (width % 4) : width + 1;
        }
        return " ".repeat(width);
      });
    })
    .join("\n");
}

export function markdownToDoc(markdown: string): JSONContent {
  const content = parseBlocks(expandTabs(markdown.replace(/\r\n/g, "\n")).split("\n"));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export function postPathFromLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const github = /^https?:\/\/(?:www\.)?github\.com\/[^/]+\/[^/]+\/(?:edit|blob|blame|raw)\/[^/]+\/(.+)$/.exec(
    trimmed,
  );
  const raw = /^https?:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/.exec(trimmed);
  const path = (github?.[1] ?? raw?.[1] ?? trimmed).split(/[?#]/)[0].replace(/^\/+/, "");
  return /\.(md|markdown)$/i.test(path) ? decodeURIComponent(path) : null;
}

export function slugFromPath(path: string): string {
  const file = path.split("/").pop() ?? "";
  return file.replace(/\.(md|markdown)$/i, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

export interface ImportedPost {
  meta: Partial<PostMeta>;
  doc: JSONContent;
}

export function parsePost(source: string): ImportedPost {
  const normalized = source.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const front = FRONT_MATTER.exec(normalized);
  return {
    meta: front ? parseFrontMatter(front[1]) : {},
    doc: markdownToDoc(front ? normalized.slice(front[0].length) : normalized),
  };
}
