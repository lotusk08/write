import { frontMatter } from "../../shared/front.ts";
import type { PostMeta } from "../../shared/types.ts";
import type { JSONContent } from "../editor/doc.ts";
import { parsePost } from "./import.ts";
import { buildFrontMatter, docToMarkdown } from "./markdown.ts";

/**
 * The Markdown file as it was last typed in the source view or opened from the blog, with a print of the front matter
 * and of the body it read as. While the post still reads as that, the source view shows it as it was written.
 */
export interface SourceText {
  text: string;
  front: string;
  body: string;
}

/** JSON with every object's keys in order, so a field set again in another order prints the same. */
function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** FNV-1a over the stable JSON: enough to tell whether a post still reads as the text it came from. */
function print(value: unknown): string {
  let hash = 0x811c9dc5;
  const text = stable(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

function parts(text: string): { front: string; body: string } {
  const found = frontMatter(text);
  return found ? { front: text.slice(0, text.length - found.rest.length), body: found.rest } : { front: "", body: text };
}

export function rememberSource(text: string, meta: PostMeta, doc: JSONContent): SourceText {
  return { text, front: print(meta), body: print(doc) };
}

/**
 * The post as one Markdown file, front matter and all, for the source view. Each half is the text as it was written
 * while the post still reads as it; a half changed since — in the page view or the menu — is written afresh. Rebuilt
 * on every switch, `_a_` came back `*a*`, `{: .info }` `{: .info}`, and blank lines moved.
 */
export function sourceFor(meta: PostMeta, doc: JSONContent, kept?: SourceText): string {
  const written = kept ? parts(kept.text) : null;
  const front = written && keptFront(kept, meta) ? written.front : `${buildFrontMatter(meta)}\n`;
  const body = written && kept?.body === print(doc) ? written.body : `${docToMarkdown(doc)}\n`;
  return front + body;
}

/** The source view's text with its front matter written afresh from `meta`, the body left as typed. */
export function withFront(text: string, meta: PostMeta): string {
  return `${buildFrontMatter(meta)}\n${parts(text).body}`;
}

/**
 * Reads the source view's text back: the body, and the post's fields from its front matter — a field taken out of it
 * is cleared, as it would be on the blog, though a post with no date keeps its own. With the front matter gone
 * altogether, the fields stay as they were.
 */
export function readSource(text: string, meta: PostMeta): { meta: PostMeta; doc: JSONContent } {
  const parsed = parsePost(text);
  if (!frontMatter(text.replace(/\r\n/g, "\n"))) {
    return { meta, doc: parsed.doc };
  }
  return {
    meta: {
      title: "",
      description: "",
      lang: "",
      tags: [],
      pin: false,
      toc: true,
      cover: null,
      moments: undefined,
      extra: undefined,
      ...parsed.meta,
      date: parsed.meta.date || meta.date,
    },
    doc: parsed.doc,
  };
}

export function sameMeta(a: PostMeta, b: PostMeta): boolean {
  return print(a) === print(b);
}

export function keptFront(kept: SourceText | undefined, meta: PostMeta): boolean {
  return kept?.front === print(meta);
}
