import type { PostMeta } from "../../shared/types.ts";
import type { Draft } from "./db.ts";
import { OLD_ATTRIBUTES, pandocAttributes } from "../editor/blog.ts";
import { type JSONContent, emptyDoc } from "../editor/doc.ts";
import type { SourceText } from "./source.ts";
import { formatPostDate, slugify } from "./text.ts";
import { languageOf } from "./topics.ts";

export type Language = "vi" | "en";

const SITE_OFFSET = 420;

export function newPostMeta(title = ""): PostMeta {
  return {
    title,
    description: "",
    date: formatPostDate(new Date(), SITE_OFFSET),
    lang: "vi",
    tags: [],
    pin: false,
    toc: false,
    cover: null,
  };
}

type StoredMeta = PostMeta & { author?: string; categories?: string[] };

export function currentMeta(meta: StoredMeta): PostMeta {
  const { author: _author, categories, ...rest } = meta;
  return { ...rest, lang: rest.lang ?? languageOf(categories ?? []) };
}

export function currentDoc(node: JSONContent): JSONContent {
  let attrs = node.attrs;
  for (const key of ["blockIal", "ial"]) {
    const value: unknown = attrs?.[key];
    if (typeof value === "string" && value.includes("{:")) {
      attrs = { ...attrs, [key]: pandocAttributes(value) };
    }
  }
  const raw = node.text?.includes("{:") && node.marks?.some((mark) => mark.type === "rawInline");
  const text = raw ? pandocAttributes(node.text!) : node.text;
  const content = node.content && takenLists(node.content.map(currentDoc));
  const kept = !content || (content.length === node.content!.length && content.every((child, index) => child === node.content![index]));
  if (attrs === node.attrs && text === node.text && kept) {
    return node;
  }
  return { ...node, ...(attrs ? { attrs } : {}), ...(text !== undefined ? { text } : {}), ...(content ? { content } : {}) };
}

const OLD_LIST = new RegExp(`^${OLD_ATTRIBUTES}`);

function takenLists(nodes: JSONContent[]): JSONContent[] {
  const list = (node: JSONContent, before: JSONContent | undefined) =>
    before?.type === "text" &&
    node.type === "text" &&
    before.marks?.some((mark) => !node.marks?.some((own) => own.type === mark.type)) &&
    !node.marks?.some((mark) => mark.type === "code" || mark.type === "rawInline")
      ? OLD_LIST.exec(node.text ?? "")
      : null;
  if (!nodes.some((node, index) => list(node, nodes[index - 1]))) {
    return nodes;
  }
  return nodes.flatMap((node, index) => {
    const found = list(node, nodes[index - 1]);
    if (!found) {
      return [node];
    }
    const rest = node.text!.slice(found[0].length);
    return [
      { type: "text", text: pandocAttributes(found[0]), marks: [...(node.marks ?? []), { type: "rawInline" }] },
      ...(rest ? [{ ...node, text: rest }] : []),
    ];
  });
}

const OLD = new RegExp(OLD_ATTRIBUTES);

export function currentSource(source: SourceText | undefined): SourceText | undefined {
  return source && OLD.test(source.text) ? undefined : source;
}

export function createDraft(title = ""): Draft {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: title || "Untitled",
    slug: slugify(title),
    doc: structuredClone(emptyDoc),
    meta: newPostMeta(title),
    createdAt: now,
    updatedAt: now,
  };
}

export function draftLabel(draft: Draft): string {
  return draft.meta.title.trim() || draft.title.trim() || "Untitled";
}

export function sortDrafts(drafts: Draft[]): Draft[] {
  return [...drafts].sort((a, b) => b.updatedAt - a.updatedAt);
}
