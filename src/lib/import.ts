import type { JSONContent } from "../editor/doc.ts";
import { frontMatter } from "../../shared/front.ts";
import { decoded } from "../../shared/paths.ts";
import { readPin } from "../../shared/pin.ts";
import type { PostMeta } from "../../shared/types.ts";
import { markdownToDoc } from "./read.ts";
import { languageOf } from "./topics.ts";

export { markdownToDoc };

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
  L: "\u2028",
  P: "\u2029",
};

const HEX_ESCAPES: Record<string, number> = { x: 2, u: 4, U: 8 };

function indentOf(line: string): number {
  return /^ */.exec(line)![0].length;
}

function blank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

function fields(lines: string[], indent: number): Field[] {
  // Any key YAML reads: `og:image`, `seo.title`, `2fa`, quoted; a field the app passes over is still kept as written.
  const key = new RegExp(`^ {${indent}}([^\\s#"'-][^\\n]*?|"(?:[^"\\\\]|\\\\.)*"|'(?:[^']|'')*'):(?=\\s|$)[ \\t]*(.*)$`);
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

function parseFrontMatter(yaml: string): Partial<PostMeta> {
  const meta: Partial<PostMeta> = {};
  const lines = yaml.split(/\r?\n/);
  if (blank(lines[lines.length - 1])) {
    lines.pop();
  }
  let cover: PostMeta["cover"] = null;
  let categories: string[] = [];
  const extra: string[] = [];
  let read = 0;

  for (const { key, value, body, from, to } of fields(lines, 0)) {
    // A comment, or any other line no field takes, is kept with the fields kept as written, ahead of the next of them.
    extra.push(...lines.slice(read, from).filter((line) => !blank(line)));
    read = to;
    switch (key) {
      case "title":
      case "description":
      case "date":
      case "lang":
        meta[key] = string(scalar(value, body, 0));
        break;
      case "tags":
        meta.tags = sequence(value, body, 0);
        break;
      case "categories":
        categories = sequence(value, body, 0);
        break;
      case "pin": {
        const found = scalar(value, body, 0);
        meta.pin = found ? readPin(found.text, found.plain) : false;
        break;
      }
      case "toc": {
        const found = scalar(value, body, 0);
        meta.toc = !(found?.plain && /^(?:false|False|FALSE)$/.test(found.text));
        break;
      }
      case "moments": {
        const found = scalar(value, body, 0);
        const flag = found?.plain ? /^(?:(true|True|TRUE)|false|False|FALSE)$/.exec(found.text) : null;
        if (flag) {
          meta.moments = Boolean(flag[1]);
        } else {
          extra.push(...lines.slice(from, to));
        }
        break;
      }
      case "author":
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
  extra.push(...lines.slice(read).filter((line) => !blank(line)));

  meta.lang = meta.lang ?? languageOf(categories);
  meta.toc = meta.toc ?? true;
  if (cover) {
    meta.cover = cover;
  }
  if (extra.length) {
    meta.extra = extra;
  }
  return meta;
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
  return /\.(md|markdown)$/i.test(path) ? decoded(path) : null;
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
  const text = source.replace(/\r\n/g, "\n");
  const front = frontMatter(text);
  return {
    meta: front ? parseFrontMatter(front.yaml) : {},
    doc: markdownToDoc(front?.rest ?? text.replace(/^\ufeff/, "")),
  };
}
