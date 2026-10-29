import { frontMatter } from "../../shared/front.ts";
import type { PostMeta } from "../../shared/types.ts";
import type { JSONContent } from "../editor/doc.ts";
import { buildFrontMatter, docToMarkdown } from "./markdown.ts";
import { loadedReader } from "./reader.ts";

export interface SourceText {
  text: string;
  front: string;
  body: string;
}

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

export function sourceFor(meta: PostMeta, doc: JSONContent, kept?: SourceText): string {
  const written = kept ? parts(kept.text) : null;
  const front = written && keptFront(kept, meta) ? written.front : `${buildFrontMatter(meta)}\n`;
  const body = written && kept?.body === print(doc) ? written.body : `${docToMarkdown(doc)}\n`;
  return front + body;
}

export function withFront(text: string, meta: PostMeta): string {
  return `${buildFrontMatter(meta)}\n${parts(text).body}`;
}

export function readSource(text: string, meta: PostMeta): { meta: PostMeta; doc: JSONContent } {
  const reader = loadedReader();
  if (!reader) {
    throw new Error("The Markdown reader has not loaded.");
  }
  const parsed = reader.parsePost(text);
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
