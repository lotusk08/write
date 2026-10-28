import type { Token } from "markdown-it";
import type { JSONContent } from "../editor/doc.ts";
import { ATTRIBUTES } from "../editor/blog.ts";
import { meta } from "./kramdown.ts";

/*
 * markdown-it's inline tokens as the editor's text and marks. What the editor has no mark for, or cannot hold as one
 * (a link with no text, a mark split across another), is kept as written, as raw text the writer puts back untouched.
 */

/** A link's address without the angle brackets that let it hold spaces or parentheses. */
export const unbracketed = (href: string) => href.replace(/^<([^<>\n]*)>$/, "$1");

type Mark = { type: string; attrs?: Record<string, unknown> };

const MARKS: Record<string, string> = {
  em: "italic",
  strong: "bold",
  s: "strike",
  a: "link",
  u: "underline",
  mark: "highlight",
  sup: "superscript",
  sub: "subscript",
};
const PAIRED_TAG = /^<(\/?)(u|mark|sup|sub)>$/;
const RAW: Mark = { type: "rawInline" };
const REF_MARKS = new Set(["bold", "italic", "strike", "underline", "highlight"]);
export const INLINE_IAL = new RegExp(`^${ATTRIBUTES}`);
const FILEPATH = /^\{\s*\.path\s*\}/;
const ESCAPE = /\\([!-/:-@[-`{-~])/g;

interface Pair {
  kind: string;
  html: boolean;
  open: number;
  close: number;
  raw: boolean;
  covered: boolean;
  within: string[];
}

function text(value: string, marks: Mark[]): JSONContent {
  return marks.length ? { type: "text", text: value, marks } : { type: "text", text: value };
}

function tagOf(token: Token): { kind: string; html: boolean; opens: boolean } | null {
  const markdown = /^(em|strong|s)_(open|close)$/.exec(token.type);
  if (markdown) {
    return { kind: markdown[1], html: false, opens: token.nesting > 0 };
  }
  if (token.type === "link_open" || token.type === "link_close") {
    return token.markup === "linkify" ? null : { kind: "a", html: false, opens: token.nesting > 0 };
  }
  const tag = token.type === "html_inline" ? PAIRED_TAG.exec(token.content) : null;
  return tag ? { kind: tag[2], html: true, opens: !tag[1] } : null;
}

function pairsOf(tokens: Token[]): Map<number, Pair> {
  const found = new Map<number, Pair>();
  const open: Record<string, Pair[]> = {};
  tokens.forEach((token, index) => {
    const tag = tagOf(token);
    if (!tag) {
      return;
    }
    if (tag.opens) {
      (open[tag.kind] ??= []).push({ ...tag, open: index, close: -1, raw: false, covered: false, within: [] });
      return;
    }
    const pair = open[tag.kind]?.pop();
    if (pair) {
      pair.close = index;
      found.set(pair.open, pair);
      found.set(index, pair);
    }
  });
  return found;
}

function substantive(token: Token): boolean {
  return token.type !== "text" || token.content !== "";
}

function conflicts(a: string, b: string): boolean {
  return a === b || (a === "superscript" && b === "subscript") || (a === "subscript" && b === "superscript");
}

/** A link's address and title, as the editor keeps them. */
function linkAttrs(token: Token): Record<string, string> {
  const title = token.attrGet("title");
  return { href: unbracketed(String(token.attrGet("href") ?? "")), ...(title ? { title: String(title) } : {}) };
}

function follows(tokens: Token[], pairs: Map<number, Pair>, pair: Pair, silent: (index: number) => boolean): boolean {
  const same = (other: Pair) =>
    other.kind === pair.kind &&
    (pair.kind !== "a" || JSON.stringify(linkAttrs(tokens[other.open])) === JSON.stringify(linkAttrs(tokens[pair.open])));
  for (let index = pair.open - 1; index >= 0 && silent(index); index--) {
    const other = pairs.get(index);
    if (other && other.close === index && !other.raw && same(other)) {
      return true;
    }
  }
  return false;
}

function settlePairs(tokens: Token[], pairs: Map<number, Pair>, images: boolean): [number, number][] {
  const all = [...new Set(pairs.values())].sort((a, b) => a.open - b.open);
  const rawLinks: [number, number][] = [];
  const empty = (index: number) => tokens[index].type === "text" && !tokens[index].content;
  for (const pair of all) {
    const inner = tokens.slice(pair.open + 1, pair.close);
    if (
      !inner.some(substantive) ||
      (images && inner.some((token) => token.type === "image")) ||
      (!REF_MARKS.has(MARKS[pair.kind]) && pair.kind !== "a" && inner.some((token) => token.type === "footnote_ref")) ||
      (pair.kind === "a" && follows(tokens, pairs, pair, (index) => empty(index) || pairs.has(index)))
    ) {
      pair.raw = true;
      if (pair.kind === "a") {
        rawLinks.push([pair.open, pair.close]);
      }
    }
  }
  const inLink = (index: number) => rawLinks.some(([open, close]) => index > open && index < close);
  for (const pair of all) {
    if (inLink(pair.open) && inLink(pair.close)) {
      pair.covered = true;
    } else if (inLink(pair.open) || inLink(pair.close)) {
      pair.raw = true;
    }
  }
  const active: Pair[] = [];
  tokens.forEach((_, index) => {
    const pair = pairs.get(index);
    if (!pair || pair.raw || pair.covered) {
      return;
    }
    if (index === pair.open) {
      if (active.some((other) => conflicts(MARKS[other.kind], MARKS[pair.kind]))) {
        pair.raw = true;
      } else {
        active.push(pair);
      }
      return;
    }
    const above = active.slice(active.indexOf(pair) + 1);
    const victims = !pair.html && above.length && above.every((other) => other.html) ? above : [pair];
    if (above.length) {
      victims.forEach((victim) => (victim.raw = true));
    }
    for (const done of new Set([pair, ...victims])) {
      active.splice(active.indexOf(done), 1);
    }
  });
  for (const pair of all) {
    const silent = (index: number) =>
      empty(index) || (pairs.has(index) && !pairs.get(index)!.raw && !pairs.get(index)!.covered);
    if (!pair.raw && !pair.covered && pair.kind !== "a" && follows(tokens, pairs, pair, silent)) {
      pair.raw = true;
    }
  }
  for (const pair of all) {
    if (pair.raw || pair.covered) {
      continue;
    }
    let first = pair.open + 1;
    while (first < pair.close && empty(first)) {
      first += 1;
    }
    let last = pair.close - 1;
    while (last > pair.open && empty(last)) {
      last -= 1;
    }
    const inner = pairs.get(first);
    if (inner && inner !== pair && !inner.raw && !inner.covered && inner.open === first && inner.close === last) {
      inner.within = [...pair.within, MARKS[pair.kind]];
    }
  }
  return rawLinks;
}

function markOf(pair: Pair, token: Token): Mark {
  const within = pair.within.length ? { within: pair.within.join(" ") } : {};
  if (pair.kind === "a") {
    return { type: "link", attrs: { ...linkAttrs(token), ...within } };
  }
  return pair.within.length ? { type: MARKS[pair.kind], attrs: within } : { type: MARKS[pair.kind] };
}

function beside(tokens: Token[], from: number, step: number): number {
  let i = from + step;
  while (tokens[i]?.type === "text" && !tokens[i].content) {
    i += step;
  }
  return i;
}

/** `***both***` as bold around italic, as the editor marks it. */
function boldItalic(tokens: Token[]): void {
  for (const [i, open] of tokens.entries()) {
    if (open.type !== "em_open") {
      continue;
    }
    const opens = beside(tokens, i, 1);
    if (tokens[opens]?.type !== "strong_open" || tokens[opens].markup[0] !== open.markup[0]) {
      continue;
    }
    const closes = tokens.findIndex((other, j) => j > i && other.type === "em_close" && other.level === open.level);
    if (closes < 0 || tokens[beside(tokens, closes, -1)]?.type !== "strong_close") {
      continue;
    }
    for (const [outer, inner] of [
      [open, tokens[opens]],
      [tokens[closes], tokens[beside(tokens, closes, -1)]],
    ]) {
      [outer.type, inner.type] = [inner.type, outer.type];
      [outer.markup, inner.markup] = [inner.markup, outer.markup];
    }
  }
}

/** The editor's text and marks for one run of inline Markdown; a photo where `images` is false is kept as written. */
export function inlineContent(source: string, children: Token[], images: boolean): JSONContent[] {
  const tokens = children;
  boldItalic(tokens);
  const pairs = pairsOf(tokens);
  const rawLinks = settlePairs(tokens, pairs, images);
  const out: JSONContent[] = [];
  const open: { pair: Pair; mark: Mark }[] = [];
  const marks = () => open.map((entry) => entry.mark);
  const written = (token: Token) => source.slice(meta(token).start ?? 0, meta(token).end ?? 0);
  /** The text written right after a token: an escaped `\{.path}` reads as the same text as `{.path}`, but is not one. */
  const after = (token: Token) => source.slice(meta(token).end ?? source.length);
  const emit = (value: string, extra: Mark[] = []) => {
    if (!value) {
      return;
    }
    const last = out[out.length - 1];
    const node = text(value, [...marks(), ...extra]);
    if (last?.type === "text" && JSON.stringify(last.marks ?? []) === JSON.stringify(node.marks ?? [])) {
      last.text += value;
    } else {
      out.push(node);
    }
  };
  const withMarks = (node: JSONContent) => (open.length ? { ...node, marks: marks() } : node);
  let filepath = "";

  tokens.forEach((token, index) => {
    const link = rawLinks.find(([start, end]) => index >= start && index <= end);
    if (link) {
      if (index === link[0]) {
        emit(written(token), [RAW]);
      }
      return;
    }
    const pair = pairs.get(index);
    if (pair && !pair.raw) {
      if (index === pair.open) {
        open.push({ pair, mark: markOf(pair, token) });
      } else {
        open.splice(
          open.findIndex((entry) => entry.pair === pair),
          1,
        );
      }
      return;
    }
    if (pair) {
      emit(pair.html ? token.content : `<${token.nesting > 0 ? "" : "/"}${pair.kind}>`, [RAW]);
      return;
    }
    switch (token.type) {
      case "text": {
        const content = token.content.slice(filepath.length);
        filepath = "";
        // An attribute list right after a link, a mark or code is the blog's, kept as written: `[In](…){icon="linkedin"}`.
        const before = tokens[index - 1];
        const list =
          content === token.content &&
          before &&
          (before.nesting === -1 || before.type === "code_inline" || (!images && before.type === "image"))
            ? INLINE_IAL.exec(after(before))
            : null;
        const attributes = list && content.startsWith(list[0]) ? list : null;
        if (attributes) {
          emit(attributes[0], [RAW]);
        }
        emit(content.slice(attributes?.[0].length ?? 0));
        break;
      }
      case "softbreak":
      case "hardbreak":
        out.push(withMarks({ type: "hardBreak" }));
        break;
      case "code_inline": {
        const next = tokens[index + 1];
        const path = FILEPATH.exec(after(token))?.[0] ?? "";
        filepath = path && next?.type === "text" && next.content.startsWith(path) ? path : "";
        out.push(text(token.content, [...marks(), { type: "code", ...(filepath ? { attrs: { filepath: true } } : {}) }]));
        break;
      }
      case "image":
        if (!images) {
          emit(written(token), [RAW]);
          break;
        }
        out.push({
          type: "image",
          attrs: {
            src: token.attrGet("src"),
            alt: token.content.replace(ESCAPE, "$1"),
            title: token.attrGet("title") || null,
          },
        });
        break;
      case "footnote_ref":
        if (meta(token).label === undefined) {
          emit(written(token), [RAW]);
        } else {
          out.push(withMarks({ type: "footnoteRef", attrs: { label: meta(token).label } }));
        }
        break;
      case "html_inline":
        emit(token.content, [RAW]);
        break;
      default:
        break;
    }
  });
  return out;
}
