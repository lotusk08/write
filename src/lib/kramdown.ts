import type { Env, StateCore, Token } from "markdown-it";
import { ALERT, ATTRIBUTES, noteOfAlert } from "../editor/blog.ts";

/*
 * The rules of the blog's `scripts/markdown/content.ts` that shape a post, written as it writes them, for the app's
 * reader: kramdown's quotes that take the lines under them, attribute lists and tables without a header, callouts named
 * on a quote's first line, links with spaces. Where the blog would draw something (a class, an icon), these leave a
 * note on the token for the reader instead. A change to the blog's rules belongs here too. The last few rules are the
 * app's own: they keep what the blog draws or drops (a task's box, a link's definition) as it was written.
 */

export interface ReadEnv extends Env {
  /** The post's lines as written, one for each line markdown-it reads, which the lazy quotes rule rewrote. */
  source?: string[];
  /** The lines the lazy quotes rule put in, which were not written. */
  inserted?: Set<number>;
  tableAttrs?: Set<number>;
  /** Link reference definitions, out of the tokens while the blog's rules run, as the blog has them. */
  definitions?: Token[];
}

export type Meta = {
  /** The attribute lists a block takes, as written: one above it, and those under it with the line each is on. */
  above?: string;
  below?: { ial: string; line: number }[];
  /** A paragraph that was an attribute list alone, and the list when no block took it. */
  attributes?: boolean;
  unclaimed?: string;
  note?: string;
  simple?: boolean;
  raw?: string;
  start?: number;
  end?: number;
  label?: string;
  checked?: boolean;
};

export const meta = (token: Token): Meta => (token.meta ?? {}) as Meta;

export function setMeta(token: Token, patch: Meta): void {
  token.meta = { ...token.meta, ...patch };
}

interface Fence {
  char: string;
  size: number;
}

export const IAL = new RegExp(String.raw`^ {0,3}(${ATTRIBUTES})\s*$`);
const RULE_LINE = /^ {0,3}([-*_=])(\s*\1){2,}\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
const QUOTED = /^\s*>/;
export const QUOTE_MARKS = /^(?:\s*> ?)+/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])( +)\S/;
const HEADING = /^\s*#{1,6}(?:\s|$)/;
const SPACED_LINK = /\]\((?!<)([^()<>\n"']*?)(\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g;
const ROW = /(?<!\\)\|/;
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const HTML_NAMES =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const HTML_BLOCK = new RegExp(
  `^\\s*(?:<(?:script|pre|style|textarea)(?=\\s|>|$)|<!--|<\\?|<![A-Z]|<!\\[CDATA\\[|</?(?:${HTML_NAMES})(?=\\s|/?>|$))`,
  "i",
);

export const columns = (text: string) => [...text].reduce((n, c) => (c === "\t" ? n + 4 - (n % 4) : n + 1), 0);

function opens(line: string): Fence | null {
  const m = FENCE.exec(line);
  if (!m || (m[1][0] === "`" && m[2].includes("`"))) {
    return null;
  }
  return { char: m[1][0], size: m[1].length };
}

function closes(line: string, fence: Fence): boolean {
  const m = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
  return Boolean(m) && m![1][0] === fence.char && m![1].length >= fence.size;
}

const spaced = (text: string) =>
  text.replace(SPACED_LINK, (link: string, target: string, title = "") =>
    /\s/.test(target.trim()) ? `](<${target.trim()}>${title})` : link,
  );

function unspaced(line: string): string {
  const runs = [...line.matchAll(/`+/g)];
  let out = "";
  let at = 0;
  for (const [k, run] of runs.entries()) {
    if (run.index < at) {
      continue;
    }
    const close = runs.find((other, j) => j > k && other[0].length === run[0].length);
    if (!close) {
      continue;
    }
    const end = close.index + close[0].length;
    out += spaced(line.slice(at, run.index)) + line.slice(run.index, end);
    at = end;
  }
  return out + spaced(line.slice(at));
}

/** kramdown's quotes, which take each line under them until a blank one, marked or not. */
export function lazyQuotes(state: StateCore): void {
  if (state.inlineMode) {
    return;
  }
  const lines = state.src.split("\n");
  const out: string[] = [];
  const written: string[] = [];
  const inserted = new Set<number>();
  const tableAttrs = new Set<number>();

  let fence: Fence | null = null;
  let inner: Fence | null = null;
  let quote: string | null = null;
  let code = false;
  let items: number[] = [];
  let open = true;
  let pipes = 0;
  let table = false;

  const insert = (line: string) => {
    inserted.add(out.length);
    out.push(line);
    written.push(line);
  };

  for (const [i, line] of lines.entries()) {
    const blank = !line.trim();
    const lead = /^\s*/.exec(line)![0];
    const indent = columns(lead);
    const own = indent - Math.max(0, ...items.filter((col) => col <= indent));

    let inFence = Boolean(fence);
    let closed = false;
    if (fence) {
      closed = closes(line, fence);
      if (closed) {
        fence = null;
      }
    } else if (!code && own < 4 && opens(line)) {
      fence = opens(line);
      inFence = true;
      quote = null;
      inner = null;
    }

    if (!inFence) {
      if (code && !blank && own < 4) {
        code = false;
      } else if (!code && !blank && own >= 4 && open && quote === null) {
        code = true;
      }
    }

    const quoted = !inFence && !code && own < 4 && QUOTED.test(line);
    let lazy = false;
    if (!inFence && !code) {
      if (blank) {
        quote = null;
        items = items.filter((col) => col <= indent);
      } else if (quoted) {
        quote = lead;
      } else if (quote !== null && own < 4 && HTML_BLOCK.test(line)) {
        quote = null;
      } else if (quote !== null && indent < columns(quote) && LIST_ITEM.test(line)) {
        quote = null;
      } else if (quote !== null && !IAL.test(line) && !RULE_LINE.test(line)) {
        lazy = true;
      }
      if (quote === null) {
        inner = null;
      }

      const item = !quoted && LIST_ITEM.exec(line);
      if (item) {
        const gap = item[3].length > 4 ? 1 : item[3].length;
        items = [...items.filter((col) => col <= indent), indent + item[2].length + gap];
      } else if (!blank && open) {
        items = items.filter((col) => col <= indent);
      }
    }

    let coded = inFence || code;
    if (quote !== null && !inFence) {
      const body = lazy ? line : line.replace(QUOTE_MARKS, "");
      if (inner) {
        coded = true;
        if (closes(body, inner)) {
          inner = null;
        }
      } else if (opens(body)) {
        inner = opens(body);
        coded = true;
      }
    }

    const inside = quoted ? line.replace(QUOTE_MARKS, "") : line;
    const marks = quoted ? QUOTE_MARKS.exec(line)![0].trimEnd() : "";
    const attrs = !coded && IAL.test(inside);
    if (coded || (quote !== null && !quoted) || !inside.trim()) {
      pipes = 0;
      table = false;
    } else if (attrs) {
      if (table) {
        insert(marks);
        tableAttrs.add(out.length);
      }
      pipes = 0;
      table = false;
    } else if (ROW.test(inside)) {
      if (pipes && DELIMITER.test(inside)) {
        table = true;
      }
      pipes++;
    } else {
      pipes = 0;
      table = false;
    }

    out.push(lazy ? `${quote}> ${line.slice(Math.min(lead.length, quote!.length))}` : line);
    written.push(line);

    open = blank || (!inFence && HEADING.test(line)) || closed;
    if (attrs && lines[i + 1]?.trim()) {
      insert(marks);
      quote = null;
      inner = null;
      open = true;
    }
  }

  state.src = out.join("\n");
  const env = state.env as ReadEnv;
  env.source = written;
  env.inserted = inserted;
  env.tableAttrs = tableAttrs;
}

/** `> [!info]` on a quote's first line names its callout, and is not shown. */
export function alerts(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "blockquote_open" || tokens[i + 1]?.type !== "paragraph_open" || tokens[i + 2]?.type !== "inline") {
      continue;
    }
    const lines = tokens[i + 2].content.split("\n");
    const note = ALERT.test(lines[0]) ? noteOfAlert(lines[0]) : null;
    if (!note) {
      continue;
    }
    setMeta(tokens[i], { note });
    if (lines.length > 1) {
      tokens[i + 2].content = lines.slice(1).join("\n");
      const map = tokens[i + 1].map;
      tokens[i + 1].map = map && [map[0] + 1, map[1]];
    } else {
      tokens.splice(i + 1, 3);
    }
  }
}

export function spacedLinks(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.type === "inline") {
      token.content = unspaced(token.content);
    }
  }
}

function enclosing(tokens: Token[], idx: number): Token | null {
  const level = tokens[idx].level;
  if (level === 0) {
    return null;
  }
  for (let i = idx - 1; i >= 0; i--) {
    if (tokens[i].nesting === 1 && tokens[i].level === level - 1) {
      return tokens[i];
    }
  }
  return null;
}

function chainOf(tokens: Token[], idx: number): Token[] {
  const chain: Token[] = [];
  for (let at = idx; ; ) {
    const container = enclosing(tokens, at);
    if (!container) {
      break;
    }
    chain.push(container);
    at = tokens.indexOf(container);
  }
  return chain;
}

function quoteFor(chain: Token[], line: string): Token | null {
  if (QUOTED.test(line)) {
    return null;
  }
  return chain.filter((token) => token.type === "blockquote_open").pop() ?? null;
}

function tableFor(env: ReadEnv, tokens: Token[], idx: number): Token | null {
  if (!env.tableAttrs?.has(tokens[idx].map![0])) {
    return null;
  }
  for (let i = idx - 1; i >= 0; i--) {
    if (tokens[i].type === "table_open" && tokens[i].level === tokens[idx].level) {
      return tokens[i];
    }
  }
  return null;
}

function blockFor(source: string[], tokens: Token[], paragraphIdx: number): Token {
  const paragraph = tokens[paragraphIdx];
  const line = source[paragraph.map![1] - 1] ?? "";
  const chain = chainOf(tokens, paragraphIdx);
  const quote = quoteFor(chain, line);
  if (quote) {
    return quote;
  }
  const item = chain[0];
  if (item?.type === "list_item_open") {
    const marker = /^(\s*)([-*+]|\d+[.)])(\s+)/.exec(source[item.map![0]] ?? "");
    const indent = marker ? marker[1].length + marker[2].length + marker[3].length : 2;
    if (/^ */.exec(line)![0].length < indent) {
      return chain[1] ?? paragraph;
    }
  }
  return paragraph;
}

function previousBlock(tokens: Token[], idx: number): Token | null {
  const level = tokens[idx].level;
  const adjacent = (token: Token | undefined) => (token?.map && token.map[1] === tokens[idx].map![0] ? token : null);
  for (let i = idx - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token.level !== level) {
      continue;
    }
    if (token.nesting === 0) {
      return adjacent(token);
    }
    if (token.nesting !== -1) {
      return null;
    }
    for (let j = i - 1; j >= 0; j--) {
      if (tokens[j].nesting === 1 && tokens[j].level === level) {
        return adjacent(tokens[j]);
      }
    }
    return null;
  }
  return null;
}

function nextBlock(tokens: Token[], from: number, level: number): Token | null {
  for (let i = from; i < tokens.length; i++) {
    if (tokens[i].level < level) {
      return null;
    }
    if (tokens[i].nesting >= 0 && tokens[i].level === level) {
      return tokens[i];
    }
  }
  return null;
}

/** An attribute list given to a block, the first it takes kept: the editor holds one list for each block. */
function give(token: Token, ial: string, above: boolean, line: number): void {
  const taken = meta(token);
  if (above && !taken.above) {
    setMeta(token, { above: ial.trim() });
  } else if (!above) {
    setMeta(token, { below: [...(taken.below ?? []), { ial: ial.trim(), line }] });
  }
}

/** An attribute list on a line of its own goes to the block it is written against, as kramdown gives it. */
export function blockAttrs(state: StateCore): void {
  const tokens = state.tokens;
  const env = state.env as ReadEnv;
  const source = env.source!;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "paragraph_open" || tokens[i + 1]?.type !== "inline") {
      continue;
    }
    const inline = tokens[i + 1];
    const lines = inline.content.split("\n");
    const first = IAL.exec(lines[0]);
    const last = IAL.exec(lines[lines.length - 1]);

    if (first && lines.length > 1) {
      lines.shift();
      inline.content = lines.join("\n");
      give(tokens[i], first[1], true, tokens[i].map![0]);
      if (!IAL.test(lines[lines.length - 1])) {
        continue;
      }
    }
    if (!last) {
      continue;
    }

    if (lines.length === 1) {
      const written = source[tokens[i].map![0]] ?? "";
      const below = quoteFor(chainOf(tokens, i), written) ?? tableFor(env, tokens, i) ?? previousBlock(tokens, i);
      const above = below ? null : nextBlock(tokens, i + 3, tokens[i].level);
      const target = below ?? above;
      if (target) {
        give(target, last[1], Boolean(above), tokens[i].map![0]);
      }
      setMeta(tokens[i], { attributes: true, ...(target ? {} : { unclaimed: last[1].trim() }) });
      inline.content = "";
      continue;
    }

    lines.pop();
    inline.content = lines.join("\n");
    give(blockFor(source, tokens, i), last[1], false, tokens[i].map![1] - 1);
  }
}

const CELL = /(?<!\\)\|/g;
const CODE_SPAN = /(`+)[^`]*?\1/g;

const masked = (line: string) => line.replace(CODE_SPAN, (span) => " ".repeat(span.length));

const hasCell = (line: string) => ROW.test(masked(line));

function cells(line: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (const m of masked(line).matchAll(CELL)) {
    parts.push(line.slice(start, m.index).trim());
    start = m.index + 1;
  }
  parts.push(line.slice(start).trim());
  if (!parts[0]) {
    parts.shift();
  }
  if (parts.length && !parts.at(-1)) {
    parts.pop();
  }
  return parts;
}

/** kramdown's tables, rows of cells with no header or rule under it. */
export function simpleTables(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "paragraph_open" || tokens[i + 1]?.type !== "inline") {
      continue;
    }
    const inline = tokens[i + 1];
    const rows = inline.content.split("\n");
    if (!rows.every((row) => row.trim() && hasCell(row))) {
      continue;
    }
    const level = tokens[i].level;
    const token = (type: string, tag: string, nesting: Token["nesting"], extra?: Partial<Token>) =>
      Object.assign(new state.Token(type, tag, nesting), { level, block: true, ...extra });
    const table = [
      token("table_open", "table", 1, { map: tokens[i].map, meta: { ...tokens[i].meta, simple: true } }),
      token("tbody_open", "tbody", 1),
    ];
    for (const row of rows) {
      table.push(token("tr_open", "tr", 1));
      for (const cell of cells(row)) {
        table.push(token("td_open", "td", 1), token("inline", "", 0, { content: cell, children: [] }), token("td_close", "td", -1));
      }
      table.push(token("tr_close", "tr", -1));
    }
    table.push(token("tbody_close", "tbody", -1), token("table_close", "table", -1));
    tokens.splice(i, 3, ...table);
    i += table.length - 1;
  }
}

const TASK = /^\[([ xX])\]\s+/;

/** `- [x] ` opening an item marks it a task, done or not; the box is not text of the item. */
export function taskItems(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const [item, paragraph, inline] = [tokens[i - 2], tokens[i - 1], tokens[i]];
    if (item.type !== "list_item_open" || paragraph.type !== "paragraph_open" || inline.type !== "inline") {
      continue;
    }
    const task = paragraph.map?.[0] === item.map?.[0] ? TASK.exec(inline.content) : null;
    if (task) {
      inline.content = inline.content.slice(task[0].length);
      setMeta(item, { checked: task[1] !== " " });
    }
  }
}

/** Link reference definitions draw nothing, and the blog's rules never see them; the editor keeps them as written. */
export function setDefinitionsAside(state: StateCore): void {
  const env = state.env as ReadEnv;
  env.definitions = state.tokens.filter((token) => token.type === "reference_definition");
  state.tokens = state.tokens.filter((token) => token.type !== "reference_definition");
}

/** Each definition back where it was written: before the first block after it, or the end of the block it was in. */
export function withDefinitions(tokens: Token[], definitions: Token[]): Token[] {
  const out = [...tokens];
  for (const definition of definitions) {
    const [from, to] = definition.map!;
    let at = out.findLastIndex((token) => token.map && token.map[0] <= from) + 1;
    while (
      at < out.length &&
      !(out[at].map && out[at].map![0] >= to) &&
      !(out[at].nesting === -1 && out[at].level < definition.level)
    ) {
      at += 1;
    }
    out.splice(at, 0, definition);
  }
  return out;
}
