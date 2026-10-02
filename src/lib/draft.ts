import type { PostMeta } from "../../shared/types.ts";
import type { Draft } from "./db.ts";
import { emptyDoc } from "../editor/extensions.ts";
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
