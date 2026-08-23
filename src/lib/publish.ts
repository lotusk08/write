import type { JSONContent } from "@tiptap/core";
import type { PublishFile } from "../../shared/types.ts";
import type { Draft, StoredImage } from "./db.ts";
import { imageStore, isLocalSrc, localId } from "./db.ts";
import { blobToBase64, toWebp } from "./images.ts";
import { buildPostFile } from "./markdown.ts";
import type { Settings } from "./settings.ts";
import { datePrefix, slugify } from "./text.ts";

export interface PublishPlan {
  slug: string;
  /** Repo-relative path of the Markdown file. */
  markdownPath: string;
  markdown: string;
  files: PublishFile[];
  /** Editor src → published URL. */
  imageUrls: Map<string, string>;
  /** Images referenced by the document but no longer in this browser. */
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

/**
 * File names the post already points at. Editing a published post means most
 * of its images are already on the blog, and a new one must not be given a
 * name one of them is using.
 */
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

/**
 * Names every local image after the post slug, matching the blog's flat
 * `assets/img/post/<slug>.webp` convention. The cover keeps the bare slug and
 * inline images are numbered in document order — skipping any number the post
 * is already using, so editing a post never overwrites the images it came in
 * with. Images already on the blog are left alone entirely: they are not
 * re-encoded, re-uploaded or renamed.
 */
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

function passthroughType(type: string): boolean {
  return type === "image/gif" || type === "image/svg+xml";
}

function storedExtension(image: StoredImage): string {
  const fromName = image.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) {
    return fromName;
  }
  return image.type.split("/")[1] ?? "png";
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

/**
 * Renders the post exactly as it will look on the blog, without spending time
 * re-encoding images. Used for the download/copy actions.
 */
export async function markdownForExport(draft: Draft, settings: Settings): Promise<string> {
  const slug = draftSlug(draft);
  const imagesDir = settings.imagesDir.replace(/^\/+|\/+$/g, "");
  const imageUrls = new Map<string, string>();

  for (const image of await planImages(draft, slug)) {
    if (!image.stored) {
      continue;
    }
    const extension =
      settings.convertImagesToWebp && !passthroughType(image.stored.type)
        ? "webp"
        : storedExtension(image.stored);
    imageUrls.set(image.src, `/${imagesDir}/${image.baseName}.${extension}`);
  }

  return buildPostFile(metaWithCover(draft, imageUrls), draft.doc, {
    resolveImage: (src) => imageUrls.get(src) ?? src,
  });
}

/**
 * Turns a draft into the exact set of files to commit: one Markdown post plus
 * every locally-stored image it references.
 */
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
    const encoded = settings.convertImagesToWebp
      ? await toWebp(image.stored.blob)
      : { blob: image.stored.blob, extension: storedExtension(image.stored) };
    const path = `${imagesDir}/${image.baseName}.${encoded.extension}`;
    files.push({ path, contentBase64: await blobToBase64(encoded.blob) });
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
