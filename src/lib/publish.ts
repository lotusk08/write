import type { JSONContent } from "@tiptap/core";
import type { PublishFile } from "../../shared/types.ts";
import type { Draft, StoredImage } from "./db.ts";
import { imageStore, isLocalSrc, localId } from "./db.ts";
import { blobToBase64, extensionFor } from "./images.ts";
import { buildPostFile } from "./markdown.ts";
import type { Settings } from "./settings.ts";
import { datePrefix, slugify } from "./text.ts";

export interface PublishPlan {
  slug: string;
  markdownPath: string;
  markdown: string;
  files: PublishFile[];
  imageUrls: Map<string, string>;
  skippedImages: string[];
}

interface PlannedImage {
  src: string;
  baseName: string;
  stored: StoredImage | undefined;
}

function collectImageSrcs(doc: JSONContent): string[] {
  const srcs: string[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === "image" && node.attrs?.src) {
      const src = String(node.attrs.src);
      if (!srcs.includes(src)) {
        srcs.push(src);
      }
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  return srcs;
}

export function draftSlug(draft: Draft): string {
  return draft.slug || slugify(draft.meta.title) || "untitled";
}

function publishedNames(doc: JSONContent): Set<string> {
  const names = new Set<string>();
  for (const src of collectImageSrcs(doc).filter((candidate) => !isLocalSrc(candidate))) {
    const file = (src.split("/").pop() ?? "").split(/[?#]/)[0];
    const base = file.replace(/\.[A-Za-z0-9]+$/, "");
    if (base) {
      names.add(base);
    }
  }
  return names;
}

async function planImages(draft: Draft, slug: string): Promise<PlannedImage[]> {
  const planned: PlannedImage[] = [];
  const cover = draft.meta.cover?.path;

  if (cover && isLocalSrc(cover)) {
    planned.push({ src: cover, baseName: slug, stored: await imageStore.get(localId(cover)) });
  }

  const taken = publishedNames(draft.doc);
  let next = 1;
  for (const src of collectImageSrcs(draft.doc).filter(isLocalSrc)) {
    while (taken.has(`${slug}-${next}`)) {
      next += 1;
    }
    const baseName = `${slug}-${next}`;
    taken.add(baseName);
    planned.push({ src, baseName, stored: await imageStore.get(localId(src)) });
  }

  return planned;
}

function metaWithCover(draft: Draft, imageUrls: Map<string, string>) {
  const cover = draft.meta.cover;
  if (!cover?.path) {
    return draft.meta;
  }
  const resolved = isLocalSrc(cover.path) ? imageUrls.get(cover.path) : cover.path;
  return { ...draft.meta, cover: resolved ? { ...cover, path: resolved } : null };
}

export function markdownPathFor(draft: Draft, settings: Settings, slug: string): string {
  const dir = (settings.publishTarget === "drafts" ? settings.draftsDir : settings.postsDir).replace(
    /^\/+|\/+$/g,
    "",
  );
  return `${dir}/${datePrefix(draft.meta.date)}-${slug}.md`;
}

export async function markdownForExport(draft: Draft, settings: Settings): Promise<string> {
  const slug = draftSlug(draft);
  const imagesDir = settings.imagesDir.replace(/^\/+|\/+$/g, "");
  const imageUrls = new Map<string, string>();

  for (const image of await planImages(draft, slug)) {
    if (image.stored) {
      const extension = extensionFor(image.stored.type, image.stored.name);
      imageUrls.set(image.src, `/${imagesDir}/${image.baseName}.${extension}`);
    }
  }

  return buildPostFile(metaWithCover(draft, imageUrls), draft.doc, {
    resolveImage: (src) => imageUrls.get(src) ?? src,
  });
}

export async function buildPublishPlan(draft: Draft, settings: Settings): Promise<PublishPlan> {
  const slug = draftSlug(draft);
  const imagesDir = settings.imagesDir.replace(/^\/+|\/+$/g, "");
  const files: PublishFile[] = [];
  const imageUrls = new Map<string, string>();
  const skippedImages: string[] = [];

  for (const image of await planImages(draft, slug)) {
    if (!image.stored) {
      skippedImages.push(image.src);
      continue;
    }
    const extension = extensionFor(image.stored.type, image.stored.name);
    const path = `${imagesDir}/${image.baseName}.${extension}`;
    files.push({ path, contentBase64: await blobToBase64(image.stored.blob) });
    imageUrls.set(image.src, `/${path}`);
  }

  const markdown = buildPostFile(metaWithCover(draft, imageUrls), draft.doc, {
    resolveImage: (src) => imageUrls.get(src) ?? src,
  });
  const markdownPath = markdownPathFor(draft, settings, slug);
  files.unshift({ path: markdownPath, contentBase64: await blobToBase64(new Blob([markdown])) });

  return { slug, markdownPath, markdown, files, imageUrls, skippedImages };
}

export function defaultCommitMessage(draft: Draft, isUpdate: boolean): string {
  const title = draft.meta.title || draft.title || "untitled";
  return `docs(post): ${isUpdate ? "update" : "add"} ${title}`;
}

export function publishBranchName(slug: string): string {
  return `post/${slug || "draft"}`;
}
