import type { JSONContent } from "@tiptap/core";
import type { PostMeta } from "../../shared/types.ts";
import { EMBED_LIQUID, EMBED_TAG, embedPlatform } from "../editor/extensions/embed.ts";
import { isGalleryKind } from "../editor/extensions/gallery.ts";

type Mark = { type: string; attrs?: Record<string, unknown> };

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[^\S\n]*(?:\r?\n|$)/;

function trimAscii(value: string): string {
  return value.replace(/^[ \t\n]+/, "").replace(/\n[ \t\n]*$/, "");
}

interface Scalar {
  text: string;
  plain: boolean;
}

interface Field {
  key: string;
  value: string;
  body: string[];
  from: number;
  to: number;
}

const BLOCK_SCALAR = /^[|>](?:([+-])([1-9])?|([1-9])([+-])?)?(?:[ \t]+#.*)?[ \t]*$/;

const ESCAPES: Record<string, string> = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  "\t": "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1b",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\x85",
  _: "\xa0",
  L: " ",
  P: " ",
};

const HEX_ESCAPES: Record<string, number> = { x: 2, u: 4, U: 8 };

function indentOf(line: string): number {
  return /^ */.exec(line)![0].length;
}

function blank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

function fields(lines: string[], indent: number): Field[] {
  const key = new RegExp(`^ {${indent}}([A-Za-z_][\\w-]*):(?=\\s|$)[ \\t]*(.*)$`);
  const item = new RegExp(`^ {${indent}}-(?:\\s|$)`);
  const found: Field[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = key.exec(lines[i]);
    if (!match) {
      continue;
    }
    const value = match[2];
    let to = i + 1;
    while (
      to < lines.length &&
      (blank(lines[to]) || indentOf(lines[to]) > indent || /^\t/.test(lines[to]) || (!value && item.test(lines[to])))
    ) {
      to += 1;
    }
    if (!BLOCK_SCALAR.test(value)) {
      while (to > i + 1 && blank(lines[to - 1])) {
        to -= 1;
      }
    }
    found.push({ key: match[1], value, body: lines.slice(i + 1, to), from: i, to });
    i = to - 1;
  }
  return found;
}

function fold(parts: string[]): string {
  let out = "";
  let empties = 0;
  for (const part of parts) {
    if (!part) {
      empties += 1;
      continue;
    }
    if (out) {
      out += empties ? "\n".repeat(empties) : " ";
    }
    out += part;
    empties = 0;
  }
  return out;
}

function blockScalar(value: string, body: string[], indent: number): string {
  const header = BLOCK_SCALAR.exec(value)!;
  const chomp = header[1] ?? header[4] ?? "";
  const width = header[2] ?? header[3];
  let column = width ? indent + Number(width) : -1;
  const texts: (string | null)[] = [];
  for (const line of body) {
    const spaces = indentOf(line);
    const empty = spaces === line.length;
    if (column === -1 && !empty) {
      column = spaces;
    }
    if (empty && (column === -1 || spaces <= column)) {
      texts.push(null);
    } else if (spaces < column) {
      break;
    } else {
      texts.push(line.slice(column));
    }
  }
  let last = texts.length - 1;
  while (last >= 0 && texts[last] === null) {
    last -= 1;
  }
  if (last === -1) {
    return chomp === "+" ? "\n".repeat(texts.length) : "";
  }
  let core = "";
  if (value[0] === "|") {
    core = texts
      .slice(0, last + 1)
      .map((text) => text ?? "")
      .join("\n");
  } else {
    let previous: "none" | "normal" | "spaced" = "none";
    let empties = 0;
    for (const text of texts.slice(0, last + 1)) {
      if (text === null) {
        empties += 1;
        continue;
      }
      const spaced = /^[ \t]/.test(text);
      if (previous === "none") {
        core += "\n".repeat(empties);
      } else if (previous === "normal" && !spaced) {
        core += empties ? "\n".repeat(empties) : " ";
      } else {
        core += "\n".repeat(empties + 1);
      }
      core += text;
      previous = spaced ? "spaced" : "normal";
      empties = 0;
    }
  }
  if (chomp === "-") {
    return core;
  }
  return chomp === "+" ? `${core}\n${"\n".repeat(texts.length - last - 1)}` : `${core}\n`;
}

function doubleQuoted(source: string): string {
  let out = "";
  let kept = 0;
  for (let i = 1; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      break;
    }
    if (char === "\\") {
      const next = source[++i];
      if (next === "\n") {
        while (i + 1 < source.length && /[ \t\n]/.test(source[i + 1])) {
          i += 1;
        }
      } else if (next in HEX_ESCAPES) {
        const digits = source.slice(i + 1, i + 1 + HEX_ESCAPES[next]);
        out += String.fromCodePoint(parseInt(digits, 16));
        i += digits.length;
      } else {
        out += ESCAPES[next] ?? next ?? "";
      }
      kept = out.length;
    } else if (char === "\n") {
      out = out.slice(0, kept) + out.slice(kept).replace(/[ \t]+$/, "");
      let breaks = 0;
      while (i + 1 < source.length && /[ \t\n]/.test(source[i + 1])) {
        breaks += source[++i] === "\n" ? 1 : 0;
      }
      out += breaks ? "\n".repeat(breaks) : " ";
      kept = out.length;
    } else {
      out += char;
    }
  }
  return out;
}

function singleQuoted(source: string): string {
  let out = "";
  for (let i = 1; i < source.length; i++) {
    const char = source[i];
    if (char === "'") {
      if (source[i + 1] !== "'") {
        break;
      }
      out += "'";
      i += 1;
    } else if (char === "\n") {
      out = out.replace(/[ \t]+$/, "");
      let breaks = 0;
      while (i + 1 < source.length && /[ \t\n]/.test(source[i + 1])) {
        breaks += source[++i] === "\n" ? 1 : 0;
      }
      out += breaks ? "\n".repeat(breaks) : " ";
    } else {
      out += char;
    }
  }
  return out;
}

function plainScalar(lines: string[]): string {
  const parts: string[] = [];
  for (const line of lines) {
    const text = line.trim();
    const comment = /(?:^|[ \t])#/.exec(text);
    if (comment) {
      parts.push(text.slice(0, comment.index).trim());
      break;
    }
    parts.push(text);
  }
  return fold(parts);
}

function scalar(value: string, body: string[], indent: number): Scalar | null {
  let head = value.trim();
  let rest = body;
  if (!head || head.startsWith("#")) {
    const next = body.findIndex((line) => !blank(line) && !/^\s*#/.test(line));
    if (next === -1) {
      return null;
    }
    head = body[next].trim();
    rest = body.slice(next + 1);
  }
  if (BLOCK_SCALAR.test(head)) {
    return { text: blockScalar(head, rest, indent), plain: false };
  }
  if (head[0] === '"') {
    return { text: doubleQuoted([head, ...rest].join("\n")), plain: false };
  }
  if (head[0] === "'") {
    return { text: singleQuoted([head, ...rest].join("\n")), plain: false };
  }
  const text = plainScalar([head, ...rest]);
  return /^(?:null|Null|NULL|~)?$/.test(text) ? null : { text, plain: true };
}

function string(found: Scalar | null): string {
  return found?.text ?? "";
}

function flowItems(source: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote = "";
  for (let i = 1; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      current += char;
      if (char === "\\" && quote === '"') {
        current += source[++i] ?? "";
      } else if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === "," || char === "]") {
      items.push(current);
      current = "";
      if (char === "]") {
        break;
      }
    } else {
      current += char;
    }
  }
  return items;
}

function sequence(value: string, body: string[], indent: number): string[] {
  let items: (Scalar | null)[];
  if (value.trim().startsWith("[")) {
    items = flowItems([value.trim(), ...body].join("\n")).map((item) => {
      const [first, ...more] = item.trim().split("\n");
      return scalar(first, more, indent);
    });
  } else if (value.trim() && !value.trim().startsWith("#")) {
    items = [scalar(value, body, indent)];
  } else {
    const first = body.find((line) => !blank(line) && !/^\s*#/.test(line));
    const column = first === undefined ? 0 : indentOf(first);
    const dash = new RegExp(`^ {${column}}-(?:[ \\t]+(.*))?$`);
    items = [];
    for (let i = 0; i < body.length; i++) {
      const match = dash.exec(body[i]);
      if (!match) {
        continue;
      }
      let to = i + 1;
      while (to < body.length && (blank(body[to]) || indentOf(body[to]) > column)) {
        to += 1;
      }
      items.push(scalar(match[1] ?? "", body.slice(i + 1, to), column));
      i = to - 1;
    }
  }
  return items.map(string).filter(Boolean);
}

export function parseFrontMatter(yaml: string): Partial<PostMeta> {
  const meta: Partial<PostMeta> = {};
  const lines = yaml.split(/\r?\n/);
  if (blank(lines[lines.length - 1])) {
    lines.pop();
  }
  let cover: PostMeta["cover"] = null;
  const extra: string[] = [];

  for (const { key, value, body, from, to } of fields(lines, 0)) {
    switch (key) {
      case "title":
      case "description":
      case "author":
      case "date":
        meta[key] = string(scalar(value, body, 0));
        break;
      case "categories":
      case "tags":
        meta[key] = sequence(value, body, 0);
        break;
      case "pin": {
        const found = scalar(value, body, 0);
        meta.pin = found?.text === "true" || (!!found?.plain && /^(?:True|TRUE)$/.test(found.text));
        break;
      }
      case "toc": {
        const found = scalar(value, body, 0);
        meta.toc = !(found?.plain && /^(?:false|False|FALSE)$/.test(found.text));
        break;
      }
      case "math":
      case "mermaid":
      case "chart":
      case "render_with_liquid":
        break;
      case "image":
        if (value.trim() && !value.trim().startsWith("#")) {
          const path = string(scalar(value, body, 0));
          cover = path ? { path, alt: "" } : null;
        } else {
          const first = body.find((line) => !blank(line));
          const indent = first === undefined ? 0 : indentOf(first);
          const nested: Record<string, string> = {};
          for (const inner of fields(body, indent)) {
            nested[inner.key] = string(scalar(inner.value, inner.body, indent));
          }
          if (nested.path) {
            cover = {
              path: nested.path,
              alt: nested.alt ?? "",
              ...(nested.lqip ? { lqip: nested.lqip } : {}),
            };
          }
        }
        break;
      default:
        extra.push(...lines.slice(from, to));
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
const AUTOLINK = /^<([a-zA-Z][\w+.-]{1,31}:[^\s<>]*)>/;
const ESCAPABLE = /[!-/:-@[-`{-~]/;

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

function emphasisEnd(rest: string, opening: string): number {
  const char = opening[0];
  const inner: number[] = [];
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
    if (char !== "~" && rest[i] === char && rest[i - 1] !== char) {
      let run = 1;
      while (rest[i + run] === char) {
        run += 1;
      }
      const closes = /\S/.test(rest[i - 1] ?? "");
      if (closes && !inner.length && run >= opening.length) {
        return i;
      }
      if (closes && inner.at(-1) === run) {
        inner.pop();
      } else if (!closes && /\S/.test(rest[i + run] ?? "")) {
        inner.push(run);
      }
      i += run;
      continue;
    }
    if (rest.startsWith(opening, i) && /\S/.test(rest[i - 1] ?? "")) {
      return i;
    }
    i += 1;
  }
  return -1;
}

function linkWithin(nodes: JSONContent[], outer: Mark[], added: Mark[]): JSONContent[] {
  const linkOf = (node: JSONContent) => (node.marks as Mark[] | undefined)?.find((mark) => mark.type === "link");
  const link = nodes.length ? linkOf(nodes[0]) : undefined;
  if (!link || outer.includes(link) || !nodes.every((node) => linkOf(node) === link)) {
    return nodes;
  }
  const within = [...added.map((mark) => mark.type), ...String(link.attrs?.within ?? "").split(" ")];
  const marked = { ...link, attrs: { ...link.attrs, within: within.filter(Boolean).join(" ") } };
  return nodes.map((node) => ({
    ...node,
    marks: (node.marks as Mark[]).map((mark) => (mark === link ? marked : mark)),
  }));
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

    if (char === "\\" && ESCAPABLE.test(source[i + 1] ?? "")) {
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
      const autolink = AUTOLINK.exec(rest);
      if (autolink) {
        flush();
        out.push(text(autolink[1], [...marks, { type: "link", attrs: { href: autolink[1] } }]));
        i += autolink[0].length;
        continue;
      }
      const tag = TAG.exec(rest);
      if (tag) {
        flush();
        const mark = { u: "underline", mark: "highlight", sup: "superscript", sub: "subscript" }[tag[1]] as string;
        out.push(...linkWithin(parseInline(tag[2], [...marks, { type: mark }]), marks, [{ type: mark }]));
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
        out.push(...linkWithin(parseInline(rest.slice(opening.length, close), [...marks, ...added]), marks, added));
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

const FENCE = /^(\s*)(```+|~~~+)(.*)$/;
const GALLERY_IAL = /^\{:[^}\n]*\}$/;

interface Fence {
  marker: string;
  info: string;
}

function openingFence(line: string): Fence | null {
  const match = FENCE.exec(line);
  if (!match) {
    return null;
  }
  const info = match[3].trim();
  if (match[2][0] === "`" && info.includes("`")) {
    return null;
  }
  return { marker: match[2], info };
}

function galleryFromFence(info: string, lines: string[]): JSONContent | null {
  const [name, kind, ...rest] = info.split(/\s+/);
  if (name !== "gallery" || !isGalleryKind(kind) || rest.length) {
    return null;
  }
  const photos: JSONContent[] = [];
  for (const line of lines) {
    const [image, tail, ...more] = parseInline(line.trim());
    if (image?.type !== "image" || more.length) {
      return null;
    }
    if (tail) {
      if (tail.type !== "text" || tail.marks?.length || !GALLERY_IAL.test(tail.text ?? "")) {
        return null;
      }
      image.attrs = { ...image.attrs, ial: tail.text };
    }
    photos.push(image);
  }
  return photos.length ? { type: "gallery", attrs: { kind }, content: photos } : null;
}
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
const BLOCK_IAL = /^ {0,3}\{:[^}\n]*\}\s*$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const SETEXT = /^ {0,3}(=+|-+)[^\S\n]*$/;
const FENCE_LINE = /^ {0,3}(?:```|~~~)/;

function isBlockStart(line: string, except: "" | "table" | "footnote" = ""): boolean {
  return (
    !line.trim() ||
    HEADING.test(line) ||
    RULE.test(line) ||
    openingFence(line) !== null ||
    MATH.test(line) ||
    HTML_BLOCK.test(line) ||
    LIQUID.test(line.trim()) ||
    (except !== "footnote" && FOOTNOTE_DEF.test(line)) ||
    LIST_START.test(line) ||
    NOTE.test(line) ||
    BLOCK_IAL.test(line) ||
    line.trimStart().startsWith(">") ||
    line.trimStart().startsWith("<details") ||
    (except !== "table" && line.trimStart().startsWith("|"))
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

function parseBlocks(lines: string[], lazy?: ReadonlySet<number>): JSONContent[] {
  const out: JSONContent[] = [];
  let i = 0;
  let pending: string | null = null;
  let pendingAt = 0;

  const keep = (value: string) => {
    out.push({ type: "rawBlock", content: [{ type: "text", text: value }] });
  };

  const settle = (last = false) => {
    if (pending === null) {
      return;
    }
    if (out.length > pendingAt) {
      out[pendingAt].attrs = { ...out[pendingAt].attrs, blockIal: pending, ialAbove: true };
      pending = null;
    } else if (last) {
      keep(pending);
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

    if (BLOCK_IAL.test(line)) {
      const value = line.trim();
      if (out.length && lines[i - 1]?.trim()) {
        out[out.length - 1].attrs = { ...out[out.length - 1].attrs, blockIal: value };
      } else {
        if (pending !== null) {
          keep(pending);
        }
        pending = value;
        pendingAt = out.length;
      }
      i += 1;
      continue;
    }

    if (MATH.test(line)) {
      const verbatim: string[] = [line];
      i += 1;
      while (i < lines.length && !MATH.test(lines[i])) {
        verbatim.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) {
        verbatim.push(lines[i]);
      }
      i += 1;
      out.push({ type: "rawBlock", content: [{ type: "text", text: verbatim.join("\n") }] });
      continue;
    }

    if (
      (LIQUID.test(line.trim()) || EMBED_TAG.test(line.trim())) &&
      !lines[i + 1]?.trim()
    ) {
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

    const fence = openingFence(line);
    if (fence) {
      const code: string[] = [];
      i += 1;
      const closes = new RegExp(`^\\s*${fence.marker[0]}{${fence.marker.length},}\\s*$`);
      while (i < lines.length && !closes.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(
        galleryFromFence(fence.info, code) ?? {
          type: "codeBlock",
          attrs: { language: fence.info || null },
          ...(code.length ? { content: [{ type: "text", text: code.join("\n") }] } : {}),
        },
      );
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
      while (i < lines.length && lines[i].trim()) {
        const marked = lines[i].trimStart().startsWith(">");
        if (!marked && (BLOCK_IAL.test(lines[i]) || FENCE_LINE.test(lines[i]))) {
          break;
        }
        quoted.push(marked ? lines[i].trimStart().replace(/^>\s?/, "") : lines[i]);
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

    if (
      line.trimStart().startsWith("|") &&
      !lazy?.has(i) &&
      i + 1 < lines.length &&
      TABLE_DIVIDER.test(lines[i + 1])
    ) {
      const header = splitRow(line);
      const align = alignments(lines[i + 1]);
      i += 2;
      const rows: JSONContent[] = [cells(header, true, align)];
      while (
        i < lines.length &&
        lines[i].trim() &&
        (lines[i].trimStart().startsWith("|") || !isBlockStart(lines[i], "footnote"))
      ) {
        const row = splitRow(lines[i]);
        while (row.length < header.length) {
          row.push("");
        }
        rows.push(cells(row, false, align));
        i += 1;
      }
      out.push({ type: "table", content: rows });
      continue;
    }

    const footnote = FOOTNOTE_DEF.exec(line);
    if (footnote) {
      const body: string[] = [line.slice(footnote[0].length)];
      const carried = new Set<number>();
      let flowing = true;
      i += 1;
      while (i < lines.length) {
        const next = lines[i];
        if (!next.trim()) {
          if (/^ {4}\S/.test(lines[i + 1] ?? "")) {
            body.push("");
            flowing = false;
            i += 1;
            continue;
          }
          break;
        }
        if (!/^ {4}/.test(next)) {
          if (!flowing || isBlockStart(next, "table")) {
            break;
          }
          carried.add(body.length);
          body.push(next);
          i += 1;
          continue;
        }
        body.push(next.slice(4));
        i += 1;
      }
      out.push({
        type: "footnoteDef",
        attrs: { label: footnote[1] },
        content: blocksOrEmpty(body, carried),
      });
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
    const opened = i;
    i += 1;
    while (
      i < lines.length &&
      !isBlockStart(lines[i], lazy?.has(i) ? "table" : "") &&
      !SETEXT.test(lines[i])
    ) {
      buffer.push(lines[i]);
      i += 1;
    }
    const carried = buffer.some((_, at) => lazy?.has(opened + at));
    const under = i < lines.length ? SETEXT.exec(lines[i]) : null;
    if (under) {
      i += 1;
      out.push({
        type: "heading",
        attrs: { level: under[1].startsWith("=") ? 1 : 2 },
        content: parseInline(trimAscii(buffer.join("\n"))),
      });
      continue;
    }
    const written = blocksFromInline(parseInline(trimAscii(buffer.join("\n"))));
    out.push(
      ...(carried
        ? written.map((block) => ({ ...block, attrs: { ...block.attrs, lazy: true } }))
        : written),
    );
  }

  settle(true);
  return rowAttributes(out);
}

function rowAttributes(blocks: JSONContent[]): JSONContent[] {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== "image" || !blocks[i].attrs?.blockIal || blocks[i].attrs?.ialAbove) {
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

function blocksOrEmpty(lines: string[], lazy?: ReadonlySet<number>): JSONContent[] {
  const parsed = parseBlocks(lines, lazy);
  return parsed.length ? parsed : [{ type: "paragraph" }];
}

const TASK = /^\[([ xX])\]\s+(.*)$/;

function parseList(lines: string[], start: number, indent: number): [JSONContent, number] {
  const items: JSONContent[] = [];
  let tasks = false;
  let ordered = false;
  let startAt = 1;
  let i = start;
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
    const carried = new Set<number>();
    const task = TASK.exec(match[3]);
    tasks = tasks || Boolean(task);
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
      if (!isBlockStart(next, "table")) {
        carried.add(body.length);
        body.push(next);
        i += 1;
        continue;
      }
      break;
    }

    items.push({
      type: task ? "taskItem" : "listItem",
      ...(task ? { attrs: { checked: task[1].toLowerCase() === "x" } } : {}),
      content: blocksOrEmpty(body, carried),
    });
  }

  const type = ordered ? "orderedList" : tasks ? "taskList" : "bulletList";
  return [
    {
      type,
      ...(ordered ? { attrs: { start: startAt } } : {}),
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
