import type { PostMeta } from "../../shared/types.ts";
import type { Draft } from "./db.ts";
import { emptyDoc } from "../editor/extensions.ts";
import type { Settings } from "./settings.ts";
import { formatPostDate, slugify } from "./text.ts";

export function newPostMeta(settings: Settings, title = ""): PostMeta {
  return {
    title,
    description: "",
    author: settings.author,
    date: formatPostDate(new Date(), settings.timezoneOffset),
    categories: [],
    tags: [],
    pin: false,
    toc: true,
    cover: null,
  };
}

export function createDraft(settings: Settings, title = ""): Draft {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: title || "Untitled",
    slug: slugify(title),
    doc: structuredClone(emptyDoc),
    meta: newPostMeta(settings, title),
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
