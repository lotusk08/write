import markdownit from "markdown-it";
import type { MarkdownIt, StateBlock, StateInline, Token } from "markdown-it";
import deflist from "markdown-it-deflist";
import footnote from "markdown-it-footnote";
import type { JSONContent } from "../editor/doc.ts";
import { ATTRIBUTES, EMBED_LIQUID, EMBED_TAG, embedPlatform, noteOfIal } from "../editor/blog.ts";
import {
  IAL,
  QUOTE_MARKS,
  type ReadEnv,
  alerts,
  blockAttrs,
  columns,
  lazyQuotes,
  meta,
  setDefinitionsAside,
  setMeta,
  simpleTables,
  spacedLinks,
  taskItems,
  withDefinitions,
} from "./kramdown.ts";
import { inlineContent, INLINE_IAL, unbracketed } from "./marks.ts";
import { upgradeSyntax } from "./upgrade.ts";

/*
 * Markdown read as the blog reads it: markdown-it with the blog's options and plugins and the rules of its own that
 * shape a post (`kramdown.ts`), then made the editor's document. The rules that only draw a post (icons, photo sizes,
 * smart quotes and dashes) are left out: the document keeps what was written.
 */

type BlockRule = (state: StateBlock, startLine: number, endLine: number, silent: boolean) => boolean;
type InlineRule = (state: StateInline, silent: boolean) => boolean;

/** A block rule changed by `wrap`, keeping the rules it may end. */
function wrapBlockRule(md: MarkdownIt, name: string, wrap: (rule: BlockRule) => BlockRule): void {
  const found = md.block.ruler.__rules__.find((rule) => rule.name === name)!;
  md.block.ruler.at(name, wrap(found.fn), { alt: found.alt });
}

/** The lines a block rule read, as written in the block holding them, kept with the token it made. */
const keepLines =
  (rule: BlockRule): BlockRule =>
  (state, startLine, endLine, silent) => {
    const count = state.tokens.length;
    if (!rule(state, startLine, endLine, silent)) {
      return false;
    }
    if (!silent && state.tokens[count]) {
      setMeta(state.tokens[count], { raw: state.getLines(startLine, state.line, state.blkIndent, false).replace(/\n+$/, "") });
    }
    return true;
  };

/** The inline rules whose tokens are kept as written, or tell what was written right after them. */
const PLACED = new Set(["backticks", "strikethrough", "emphasis", "link", "image", "autolink", "footnote_inline"]);

/** Where in its text each token an inline rule made was written, so a link or photo can be kept as written. */
const keepPlace =
  (rule: InlineRule): InlineRule =>
  (state, silent) => {
    const start = state.pos;
    const count = state.tokens.length;
    if (!rule(state, silent)) {
      return false;
    }
    if (!silent) {
      for (let i = count; i < state.tokens.length; i++) {
        if (meta(state.tokens[i]).start === undefined) {
          setMeta(state.tokens[i], { start, end: state.pos });
        }
      }
    }
    return true;
  };

function blogMarkdown(): MarkdownIt {
  const md = markdownit({ html: true, linkify: true, breaks: true });
  md.use(footnote);
  md.use(deflist);
  // Definitions stay where they were written; the blog gathers them at the end only to draw them.
  md.core.ruler.disable("footnote_tail");
  md.core.ruler.at("strip_references", setDefinitionsAside);
  md.core.ruler.before("block", "kramdown_lazy_quotes", lazyQuotes);
  md.core.ruler.before("inline", "alerts", alerts);
  md.core.ruler.before("inline", "kramdown_block_attrs", blockAttrs);
  md.core.ruler.after("kramdown_block_attrs", "kramdown_simple_tables", simpleTables);
  md.core.ruler.after("kramdown_simple_tables", "spaced_links", spacedLinks);
  md.core.ruler.after("spaced_links", "task_items", taskItems);

  // A link's address and a photo's as written: the editor writes them back as they were.
  const destination = md.helpers.parseLinkDestination;
  md.helpers.parseLinkDestination = (str, start, max) => {
    const found = destination(str, start, max);
    return found.ok ? { ...found, str: str.slice(start, found.pos) } : found;
  };
  const validate = md.validateLink.bind(md);
  md.validateLink = (url) => validate(md.utils.unescapeAll(unbracketed(url)));
  md.normalizeLink = (url) => url;
  md.normalizeLinkText = (text) => text;

  wrapBlockRule(md, "reference", keepLines);
  wrapBlockRule(md, "deflist", keepLines);
  // The spaces opening a paragraph's next line are text of it, as written; the blog draws them as the space they are.
  const newline = md.inline.ruler.__rules__.find((rule) => rule.name === "newline")!.fn;
  md.inline.ruler.at("newline", (state, silent) => {
    const at = state.pos;
    if (!newline(state, silent)) {
      return false;
    }
    state.pos = at + 1;
    return true;
  });
  for (const { name, fn } of [...md.inline.ruler.__rules__]) {
    if (PLACED.has(name)) {
      md.inline.ruler.at(name, keepPlace(fn));
    }
  }
  return md;
}

let parser: MarkdownIt | null = null;

const markdownIt = () => (parser ??= blogMarkdown());

interface Block {
  open: Token;
  children: Block[];
}

function blockTree(tokens: Token[]): Block[] {
  const root: Block[] = [];
  const stack: Block[] = [];
  for (const token of tokens) {
    if (token.nesting === -1) {
      stack.pop();
      continue;
    }
    const block = { open: token, children: [] };
    (stack.length ? stack[stack.length - 1].children : root).push(block);
    if (token.nesting === 1) {
      stack.push(block);
    }
  }
  return root;
}

/** Blocks that may sit directly under the line before them, as a list under its lead-in does; a paragraph never is one. */
const HUGGING = new Set(["bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "table", "heading", "gallery"]);

const MATH = /^\s*\$\$\s*$/;
const LIQUID = /^\{%[\s\S]*%\}$/;
const DETAILS = /^\s*<details\b[^>]*>/i;
const DETAILS_END = /<\/details>/i;
const SUMMARY = /<summary[^>]*>([\s\S]*?)<\/summary>/i;
const BREAKS = new Set(["softbreak", "hardbreak"]);
const GALLERY_IAL = new RegExp(`^${ATTRIBUTES}$`);

/**
 * A block's attribute lists, written above it or under it. The editor holds one for each block: given more, it holds
 * them as one list, under the block, as the blog joins them.
 */
function withAttributes(node: JSONContent, above?: string, below: { ial: string }[] = []): JSONContent {
  const lists = [...(above ? [above] : []), ...below.map((entry) => entry.ial)];
  const ial = lists.length > 1 ? `{${lists.map((list) => list.slice(1, -1).trim()).join(" ")}}` : lists[0];
  return ial ? { ...node, attrs: { ...node.attrs, blockIal: ial, ...(below.length ? {} : { ialAbove: true }) } } : node;
}

/** A player's address, read as HTML, the way `embedTag` writes it. */
function playerId(written: string): string {
  return written.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

interface Container {
  /** The column a line of an item or footnote starts at; a line starting before it was taken lazily. */
  indent: number | null;
  /** The line the item or footnote opens on, whose own text starts after its marker. */
  opener: number;
  quoted: boolean;
}

const TOP: Container = { indent: null, opener: -1, quoted: false };

class Reader {
  readonly md: MarkdownIt;
  readonly env: ReadEnv;
  readonly source: string[];
  readonly inserted: Set<number>;

  constructor(md: MarkdownIt, env: ReadEnv) {
    this.md = md;
    this.env = env;
    this.source = env.source ?? [];
    this.inserted = env.inserted ?? new Set();
  }

  /** Whether the line written above `line` holds anything, quote marks aside. */
  touches(line: number): boolean {
    let above = line - 1;
    while (this.inserted.has(above)) {
      above -= 1;
    }
    return above >= 0 && !/^[\s>]*$/.test(this.source[above]);
  }

  inline(token: Token | undefined, images: boolean): JSONContent[] {
    return token ? inlineContent(token.content, token.children ?? [], images) : [];
  }

  blocks(children: Block[], container: Container): JSONContent[] {
    const out: JSONContent[] = [];
    for (let i = 0; i < children.length; i++) {
      const block = children[i];
      const opened = out.length;
      const { open } = block;
      if (open.type === "html_block" && DETAILS.test(open.content)) {
        i = this.details(children, i, container, out);
      } else if (open.type === "reference_definition") {
        const written = [meta(open).raw ?? ""];
        while (children[i + 1]?.open.type === "reference_definition" && children[i + 1].open.map?.[0] === children[i].open.map?.[1]) {
          written.push(meta(children[++i].open).raw ?? "");
        }
        out.push(raw(written.join("\n")));
      } else {
        out.push(...this.block(block, container, out.length > 0));
      }
      const first = out[opened];
      if (
        first &&
        opened > 0 &&
        open.map &&
        HUGGING.has(first.type ?? "") &&
        !first.attrs?.lazy &&
        this.touches(open.map[0])
      ) {
        first.attrs = { ...first.attrs, joinPrevious: true };
      }
    }
    return rowAttributes(out);
  }

  /** The blocks of a container, a paragraph when it has none. */
  content(children: Block[], container: Container): JSONContent[] {
    const blocks = this.blocks(children, container);
    return blocks.length ? blocks : [{ type: "paragraph" }];
  }

  block(block: Block, container: Container, after: boolean): JSONContent[] {
    const { open, children } = block;
    const attributes = meta(open);
    const withIal = (node: JSONContent) => withAttributes(node, attributes.above, attributes.below);
    switch (open.type) {
      case "paragraph_open": {
        if (attributes.attributes) {
          return attributes.unclaimed ? [raw(attributes.unclaimed)] : [];
        }
        const nodes = this.paragraph(block, container, after);
        if (nodes.length === 1) {
          nodes[0] = withIal(nodes[0]);
        } else if (nodes.length) {
          nodes[0] = withAttributes(nodes[0], attributes.above);
          nodes[nodes.length - 1] = withAttributes(nodes[nodes.length - 1], undefined, attributes.below);
        }
        return nodes;
      }
      case "heading_open": {
        const level = Number(open.tag.slice(1));
        const content = this.inline(children[0]?.open, false);
        return [
          withIal({
            type: "heading",
            attrs: { level },
            content: level < 3 ? content : content.map((node) => (isBreakTag(node) ? { type: "hardBreak" } : node)),
          }),
        ];
      }
      case "blockquote_open": {
        // A callout's class under its quote, as the posts wrote it before `> [!info]`, names the callout.
        const below = attributes.below ?? [];
        const named = !attributes.note && below.length === 1 ? noteOfIal(below[0].ial) : null;
        const note = attributes.note ?? named;
        const quote: JSONContent = { type: "blockquote", attrs: { note }, content: this.content(children, { ...TOP, quoted: true }) };
        return [withAttributes(quote, attributes.above, named ? [] : below)];
      }
      case "bullet_list_open":
      case "ordered_list_open":
        return this.lists(block, container);
      case "fence": {
        const code = open.content.replace(/\n$/, "");
        const info = open.info.trim();
        return [withIal(this.gallery(info, code) ?? codeBlock(info || null, code))];
      }
      case "code_block":
        return [withIal(codeBlock(null, open.content.replace(/\n+$/, "")))];
      case "hr":
        return [withIal({ type: "horizontalRule" })];
      case "html_block":
        return [withIal(this.html(open, after))];
      case "table_open":
        return [withIal(this.table(block))];
      case "dl_open":
        return [withIal(raw(attributes.raw ?? ""))];
      case "footnote_reference_open":
        return [
          {
            type: "footnoteDef",
            attrs: { label: attributes.label },
            content: this.content(children, { indent: 4, opener: open.map?.[0] ?? -1, quoted: container.quoted }),
          },
        ];
      default:
        return children.length ? this.blocks(children, container) : [];
    }
  }

  paragraph(block: Block, container: Container, after: boolean): JSONContent[] {
    const inline = block.children[0]?.open;
    const content = inline?.content ?? "";
    const map = block.open.map;
    const lines = content.split("\n");
    // A display formula is kept as written; the blog draws it as the text it is.
    if (lines.length > 1 && MATH.test(lines[0]) && MATH.test(lines[lines.length - 1])) {
      return [raw(content)];
    }
    if (LIQUID.test(content.trim()) && !content.includes("\n") && map && !this.source[map[0] + 1]?.trim()) {
      const tag = EMBED_LIQUID.exec(content.trim());
      const platform = tag ? embedPlatform(tag[1]) : null;
      const joins = after && Boolean(map) && this.touches(map![0]) ? { joinPrevious: true } : {};
      return [
        platform && tag
          ? { type: "embed", attrs: { platform, id: tag[3], ...joins } }
          : { type: "rawBlock", attrs: joins, content: [{ type: "text", text: content.trim() }] },
      ];
    }
    // A player on the paragraph's last line is a block of its own, written under the text as the editor writes it.
    const children = inline?.children ?? [];
    const last = children.at(-1);
    const player = last?.type === "html_inline" && BREAKS.has(children.at(-2)?.type ?? "") ? EMBED_TAG.exec(last.content) : null;
    const platform = player ? embedPlatform(player[1]) : null;
    const embed: JSONContent[] = player && platform ? [{ type: "embed", attrs: { platform, id: playerId(player[3]), joinPrevious: true } }] : [];
    const text = embed.length ? inlineContent(content, children.slice(0, -2), true) : this.inline(inline, true);
    if (!embed.length && map) {
      keepTrailingSpaces(text, this.source[map[1] - 1] ?? "");
    }
    const written = blocksFromInline(text);
    return [...(this.lazy(map, container) ? written.map((node) => ({ ...node, attrs: { ...node.attrs, lazy: true } })) : written), ...embed];
  }

  /** Whether a paragraph in an item or footnote goes on in a line not indented to the item's text. */
  lazy(map: [number, number] | null, container: Container): boolean {
    if (container.indent === null || !map) {
      return false;
    }
    for (let line = map[0] + 1; line < map[1]; line++) {
      if (line === container.opener || this.inserted.has(line)) {
        continue;
      }
      const written = container.quoted ? this.source[line].replace(QUOTE_MARKS, "") : this.source[line];
      if (written.trim() && !IAL.test(written) && columns(/^\s*/.exec(written)![0]) < container.indent) {
        return true;
      }
    }
    return false;
  }

  /**
   * A list as the editor holds it: one list for each run of items written with no blank line between them, written
   * back the same way, so a loose list stays loose on the blog.
   */
  lists(block: Block, container: Container): JSONContent[] {
    const runs: { items: Block[]; from: number; hugs: boolean }[] = [];
    for (const item of block.children) {
      const at = item.open.map?.[0] ?? 0;
      const gap = !this.touches(at);
      // An attribute list written between two items ends the list above it; the next one is written under it.
      const cut = this.inserted.has(at - 1);
      if (!runs.length || gap || cut) {
        runs.push({ items: [], from: at, hugs: runs.length > 0 && !gap });
      }
      runs[runs.length - 1].items.push(item);
    }
    const { above, below = [] } = meta(block.open);
    // Each list under the items goes with the run of them written above it.
    const under = (entry: { line: number }) => runs.findLastIndex((run) => run.from <= entry.line);
    return runs.map((run, index) => {
      const lists = below.filter((entry) => under(entry) === index);
      const list = withAttributes(this.list(block.open, run.items, container), index === 0 ? above : undefined, lists);
      return run.hugs ? { ...list, attrs: { ...list.attrs, joinPrevious: true } } : list;
    });
  }

  list(open: Token, children: Block[], container: Container): JSONContent {
    const ordered = open.type === "ordered_list_open";
    let tasks = false;
    const items = children.map((item) => {
      const marker = /^(\s*)([-*+]|\d+[.)])(\s*)/.exec(
        container.quoted ? (this.source[item.open.map![0]] ?? "").replace(QUOTE_MARKS, "") : (this.source[item.open.map![0]] ?? ""),
      );
      const gap = marker && marker[3].length > 4 ? 1 : (marker?.[3].length ?? 1);
      const indent = marker ? columns(marker[1]) + marker[2].length + Math.max(gap, 1) : 2;
      const { checked } = meta(item.open);
      tasks ||= checked !== undefined;
      const content = this.content(item.children, { indent, opener: item.open.map?.[0] ?? -1, quoted: container.quoted });
      return {
        type: checked === undefined ? "listItem" : "taskItem",
        ...(checked === undefined ? {} : { attrs: { checked } }),
        content,
      };
    });
    const start = Number(children[0]?.open.info || open.attrGet("start") || 1);
    return {
      type: ordered ? "orderedList" : tasks ? "taskList" : "bulletList",
      ...(ordered ? { attrs: { start } } : {}),
      content: items,
    };
  }

  gallery(info: string, code: string): JSONContent | null {
    if (info.split(/\s+/)[0] !== "gallery") {
      return null;
    }
    const photos: JSONContent[] = [];
    for (const line of code.split("\n").filter((entry) => entry.trim())) {
      const written = line.trim();
      const tokens = this.md.parseInline(written, { references: this.env.references })[0]?.children ?? [];
      const [image, tail, ...more] = inlineContent(written, tokens, true);
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
    return photos.length ? { type: "gallery", content: photos } : null;
  }

  html(token: Token, after: boolean): JSONContent {
    const content = token.content.replace(/\n$/, "");
    const component = EMBED_TAG.exec(content.trim());
    const platform = component ? embedPlatform(component[1]) : null;
    const joins = after && token.map && this.touches(token.map[0]) ? { joinPrevious: true } : {};
    if (component && !platform) {
      return { type: "rawBlock", attrs: joins, content: [{ type: "text", text: content.trim() }] };
    }
    if (component && platform) {
      return { type: "embed", attrs: { platform, id: playerId(component[3]), ...joins } };
    }
    return raw(content);
  }

  /** `<details>` with its `<summary>`, the blocks up to its `</details>` its body; the last block it took is returned. */
  details(children: Block[], at: number, container: Container, out: JSONContent[]): number {
    const opening = children[at].open.content.replace(/\n$/, "");
    const open = !/\bopen\s*=?\s*"?(false)"?/.test(opening) && /\bopen\b/.test(opening);
    const tail = opening.replace(DETAILS, "");
    let summary = SUMMARY.exec(tail)?.[1]?.trim() ?? "";
    const rest = tail.replace(SUMMARY, "");
    // Written in one block of HTML, its body is read as Markdown, as the editor's own sections are.
    if (DETAILS_END.test(rest)) {
      out.push(collapsible(open, summary, readBlocks(rest.slice(0, rest.search(DETAILS_END)))));
      return at;
    }
    let depth = 1;
    let last = children.length - 1;
    let inner: Block[] | null = null;
    // HTML written on the lines straight under `</details>` goes on as HTML, as the blog reads it.
    let after = "";
    for (let index = at + 1; index < children.length && !inner; index++) {
      const { open: token } = children[index];
      const closing = children[index].children[0]?.open.children?.at(-1);
      if (token.type === "html_block" && DETAILS.test(token.content) && !DETAILS_END.test(token.content)) {
        depth += 1;
      } else if (token.type === "html_block" && /^\s*<\/details>/i.test(token.content) && --depth === 0) {
        inner = children.slice(at + 1, index);
        last = index;
        after = token.content.replace(/^\s*<\/details>[^\n]*\n?/i, "").replace(/\n+$/, "");
      } else if (token.type === "paragraph_open" && depth === 1 && closing?.type === "html_inline" && /^<\/details>$/i.test(closing.content)) {
        // A `</details>` ending the section's last line, as `Text.</details>`, is HTML in that paragraph.
        children[index].children[0].open.children!.pop();
        inner = children.slice(at + 1, index + 1);
        last = index;
      }
    }
    inner ??= children.slice(at + 1);
    if (!summary && inner[0]?.open.type === "html_block" && SUMMARY.test(inner[0].open.content)) {
      summary = SUMMARY.exec(inner[0].open.content)![1].trim();
      inner = inner.slice(1);
    }
    const before = rest.trim() ? readBlocks(rest) : [];
    out.push(collapsible(open, summary, [...before, ...this.blocks(inner, container)]));
    if (after.trim()) {
      out.push({ type: "rawBlock", attrs: { joinPrevious: true }, content: [{ type: "text", text: after }] });
    }
    return last;
  }

  table(block: Block): JSONContent {
    const simple = Boolean(meta(block.open).simple);
    const rows: JSONContent[] = [];
    const visit = (blocks: Block[], header: boolean) => {
      for (const child of blocks) {
        if (child.open.type === "thead_open" || child.open.type === "tbody_open") {
          visit(child.children, child.open.type === "thead_open");
        } else if (child.open.type === "tr_open") {
          rows.push({
            type: "tableRow",
            content: child.children.map((cell) => {
              const align = /text-align:\s*(left|right|center)/.exec(String(cell.open.attrGet("style") ?? ""))?.[1];
              const content = this.inline(cell.children[0]?.open, false);
              return {
                type: header && !simple ? "tableHeader" : "tableCell",
                ...(align ? { attrs: { align } } : {}),
                content: [content.length ? { type: "paragraph", content } : { type: "paragraph" }],
              };
            }),
          });
        }
      }
    };
    visit(block.children, false);
    return { type: "table", content: rows };
  }
}

/**
 * The spaces ending a paragraph's last line, which markdown-it drops, kept at the end of its text: a post written again
 * is changed only where it was edited.
 */
function keepTrailingSpaces(text: JSONContent[], line: string): void {
  const tail = IAL.test(line) ? "" : (/[ \t]+$/.exec(line)?.[0] ?? "");
  const end = text.at(-1);
  const plain = end?.type === "text" && !end.marks?.length;
  if (!tail || (plain && end.text?.endsWith(tail))) {
    return;
  }
  if (plain) {
    end.text += tail;
  } else {
    text.push({ type: "text", text: tail });
  }
}

function raw(value: string): JSONContent {
  return { type: "rawBlock", content: [{ type: "text", text: value }] };
}

function codeBlock(language: string | null, code: string): JSONContent {
  return { type: "codeBlock", attrs: { language }, ...(code ? { content: [{ type: "text", text: code }] } : {}) };
}

function collapsible(open: boolean, summary: string, body: JSONContent[]): JSONContent {
  const title = summaryText(summary || "Details");
  return {
    type: "collapsible",
    attrs: { open },
    content: [
      { type: "collapsibleSummary", content: title ? [{ type: "text", text: title }] : [] },
      { type: "collapsibleContent", content: body.length ? body : [{ type: "paragraph" }] },
    ],
  };
}

function summaryText(html: string): string {
  return markdownIt().utils.unescapeAll(html.replace(/<[^>]*>/g, "").replace(/\\/g, "\\\\"));
}

/** A `<br>` as the writer puts one in a heading from H3 down, which has no line of its own to break onto. */
function isBreakTag(node: JSONContent): boolean {
  return node.type === "text" && node.text === "<br>" && node.marks?.length === 1 && node.marks[0].type === "rawInline";
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

/** A paragraph's text with each photo in it a block of its own, the text around it paragraphs joined to it. */
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
    const sameLine = run.length ? run[run.length - 1]?.type !== "hardBreak" : out.length > 0;
    flush();
    const next = nodes[i + 1];
    const attributes = next?.type === "text" && !next.marks?.length ? INLINE_IAL.exec(next.text ?? "") : null;
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

/** A row of photos takes the attribute list written after its last photo. */
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

function readBlocks(markdown: string): JSONContent[] {
  const md = markdownIt();
  const env: ReadEnv = {};
  const tokens = withDefinitions(md.parse(upgradeSyntax(markdown.replace(/\r\n?/g, "\n")), env), env.definitions ?? []);
  return new Reader(md, env).blocks(blockTree(tokens), TOP);
}

export function markdownToDoc(markdown: string): JSONContent {
  const content = readBlocks(markdown);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
