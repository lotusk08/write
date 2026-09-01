import type { JSONContent } from "@tiptap/core";
import type { PostMeta } from "../../shared/types.ts";
import { EMBED_LIQUID } from "../editor/extensions/embed.ts";

type Mark = { type: string; attrs?: Record<string, unknown> };

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[^\S\n]*(?:\r?\n|$)/;

function trimAscii(value: string): string {
  return value.replace(/^[ \t\n]+|[ \t\n]+$/g, "");
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
      case "math":
      case "mermaid":
      case "chart":
        meta[key] = boolean(value);
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

const IMAGE = /^!\[([^\]]*)\]\(\s*([^)"]*?)(?:\s+"([^"]*)")?\s*\)/;
const LINK = /^\[((?:[^[\]\\]|\\.)*)\]\(\s*([^)"]*?)(?:\s+"([^"]*)")?\s*\)/;
const TAG = /^<(u|mark)>([\s\S]*?)<\/\1>/;

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
      if (image) {
        flush();
        out.push({
          type: "image",
          attrs: { src: image[2], alt: image[1], title: image[3] ?? null },
        });
        i += image[0].length;
        continue;
      }
    }
    if (char === "[") {
      const link = LINK.exec(rest);
      if (link) {
        flush();
        const attrs: Record<string, unknown> = { href: link[2] };
        if (link[3]) {
          attrs.title = link[3];
        }
        out.push(...parseInline(link[1], [...marks, { type: "link", attrs }]));
        i += link[0].length;
        continue;
      }
    }
    if (char === "<") {
      const tag = TAG.exec(rest);
      if (tag) {
        flush();
        const mark = tag[1] === "u" ? "underline" : "highlight";
        out.push(...parseInline(tag[2], [...marks, { type: mark }]));
        i += tag[0].length;
        continue;
      }
    }
    if (char === "*" || char === "_" || char === "~") {
      const emphasis =
        /^(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/.exec(rest) ??
        /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest) ??
        /^(~~)(?=\S)([\s\S]*?\S)\1/.exec(rest) ??
        /^(\*|_)(?=\S)([\s\S]*?\S)\1/.exec(rest);
      const underscore = emphasis?.[1].startsWith("_");
      const boundary = !underscore || !/\w/.test(source[i - 1] ?? "");
      if (emphasis && boundary) {
        const added =
          emphasis[1] === "~~"
            ? [{ type: "strike" }]
            : emphasis[1].length === 3
              ? [{ type: "bold" }, { type: "italic" }]
              : emphasis[1].length === 2
                ? [{ type: "bold" }]
                : [{ type: "italic" }];
        flush();
        out.push(...parseInline(emphasis[2], [...marks, ...added]));
        i += emphasis[0].length;
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
  for (const [index, edge] of [[0, /^[ \t]+/] as const, [-1, /[ \t]+$/] as const]) {
    const at = index === 0 ? 0 : out.length - 1;
    const node = out[at];
    if (node?.type !== "text") {
      continue;
    }
    const text = (node.text ?? "").replace(edge, "");
    if (text) {
      out[at] = { ...node, text };
    } else {
      out.splice(at, 1);
    }
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
      const rest = (next.text ?? "").slice(attributes[0].length).replace(/^[ \t]+/, "");
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
const FOOTNOTE_DEF = /^\[\^[^\]\s]+\]:/;
const DESCRIPTION = /^:\s+\S/;
const HTML_BLOCK = /^\s*<(\/?)([a-zA-Z][\w-]*)(\s[^>]*)?>/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const LIST_START = /^ {0,3}(?:[-*+]|\d+[.)])\s+/;
const NOTE = /^\{:\s*\.(?:note-)?(tip|info|important|warning|danger|author)\s*\}\s*$/;
const BLOCK_IAL = /^\{:[^}\n]*\}\s*$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

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

    if (BLOCK_IAL.test(line.trim())) {
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

    if (LIQUID.test(line.trim())) {
      const embed = EMBED_LIQUID.exec(line.trim());
      const joins = out.length > 0 && Boolean(lines[i - 1]?.trim());
      const attrs = joins ? { joinPrevious: true } : {};
      out.push(
        embed
          ? { type: "embed", attrs: { platform: embed[1], quote: embed[2], id: embed[3], ...attrs } }
          :
            {
              type: "rawBlock",
              attrs,
              content: [{ type: "text", text: line.trim() }],
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
      while (i < lines.length && lines[i].trim() && !BLOCK_IAL.test(lines[i].trim())) {
        quoted.push(lines[i]);
        i += 1;
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
    while (i < lines.length && !isBlockStart(lines[i])) {
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

  while (i < lines.length) {
    const bullet = BULLET.exec(lines[i]);
    const numbered = ORDERED.exec(lines[i]);
    const match = bullet ?? numbered;
    if (!match || match[1].length < indent) {
      break;
    }
    if (match[1].length > indent) {
      break;
    }
    if (items.length === 0) {
      ordered = Boolean(numbered);
      startAt = numbered ? Number(numbered[2]) : 1;
    } else if (Boolean(numbered) !== ordered) {
      break;
    }

    const marker = match[0].length - match[3].length;
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
