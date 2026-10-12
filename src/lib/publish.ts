import type { JSONContent } from "../editor/doc.ts";
import type { PostMeta, PublishResult, SitePhoto } from "../../shared/types.ts";
import { fetchSitePhotos, publish, uploadPhoto } from "./api.ts";
import type { Draft, StoredImage } from "./db.ts";
import { imageStore, isLocalSrc, localId } from "./db.ts";
import { blobToBase64, extensionFor, MAX_UPLOAD_BYTES, shrinkImage, tooBig } from "./images.ts";
import { buildPostFile } from "./markdown.ts";
import { decoded, servedName, stem, trimSlashes } from "../../shared/paths.ts";
import type { Settings } from "./settings.ts";
import { datePrefix, slugify } from "./text.ts";

export interface PlannedPhoto {
  path: string;
  blob: Blob;
  src: string;
  alt: string;
}

export interface PublishWarning {
  kind: "alt" | "description" | "missing" | "unguarded" | "size" | "stale" | "existing" | "retry";
  text: string;
  src?: string;
  blocks?: boolean;
}

export interface PublishPlan {
  slug: string;
  markdownPath: string;
  markdown: string;
  photos: PlannedPhoto[];
  renames: { path: string; sha: string }[];
  remove: string[];
  redirects: [string, string][];
  moved: [string, string][];
  imageUrls: Map<string, string>;
  skippedImages: string[];
  warnings: PublishWarning[];
  expect?: { path: string; sha: string }[];
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function warningsFor(draft: Draft, photos: PlannedPhoto[], skipped: string[], guarded: boolean): PublishWarning[] {
  return [
    ...photos
      .filter((photo) => tooBig(photo.blob))
      .map((photo): PublishWarning => ({
        kind: "size",
        src: photo.src,
        blocks: true,
        text: `${fileName(photo.path)} is ${megabytes(photo.blob.size)}; one photo can be ${megabytes(MAX_UPLOAD_BYTES)} at most, and this format is not reduced.`,
      })),
    ...photos
      .filter((photo) => !photo.alt.trim())
      .map((photo): PublishWarning => ({
        kind: "alt",
        src: photo.src,
        text: `A photo has no alt text, so it is named ${fileName(photo.path)}. Add some to name it.`,
      })),
    ...(skipped.length
      ? [{ kind: "missing" as const, text: `${skipped.length} photo(s) are missing from this browser's storage and will not be uploaded.` }]
      : []),
    ...(draft.meta.description?.trim() ? [] : [{ kind: "description" as const, text: "The post has no description." }]),
    ...(guarded
      ? []
      : [{ kind: "unguarded" as const, text: "This copy cannot tell whether the post changed on the site since it was opened. Open it again from the site to be safe." }]),
  ];
}

interface PlannedImage {
  src: string;
  baseName: string;
  alt?: string;
  stored?: StoredImage;
  site?: SitePhoto;
}

function collectImages(doc: JSONContent): Map<string, string> {
  const images = new Map<string, string>();
  const walk = (node: JSONContent) => {
    if (node.type === "image" && node.attrs?.src) {
      const src = String(node.attrs.src);
      if (!images.has(src)) {
        images.set(src, String(node.attrs.alt ?? ""));
      }
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  return images;
}

const NAME_LENGTH = 50;

function altSlug(alt: string): string {
  const slug = slugify(alt);
  if (slug.length <= NAME_LENGTH) {
    return slug;
  }
  const cut = slug.slice(0, NAME_LENGTH + 1);
  return (cut.includes("-") ? cut.slice(0, cut.lastIndexOf("-")) : cut.slice(0, NAME_LENGTH)).replace(/-+$/, "");
}

export function photoName(slug: string, alt: string, taken: Set<string>): string {
  const words = altSlug(alt);
  let name = words ? `${slug}-${words}` : "";
  for (let next = words ? 2 : 1; !name || taken.has(name); next += 1) {
    name = words ? `${slug}-${words}-${next}` : `${slug}-${next}`;
  }
  taken.add(name);
  return name;
}

export function draftSlug(draft: Draft): string {
  return draft.slug.replace(/-+$/, "") || slugify(draft.meta.title) || "untitled";
}

function fileOf(src: string, dir: string): string | null {
  const prefix = `/${dir}/`;
  const file = src.startsWith(prefix) ? src.slice(prefix.length).split(/[?#]/)[0] : "";
  return file && !file.includes("/") ? decoded(file) : null;
}

export async function planImages(
  draft: Draft,
  slug: string,
  dir: string,
  site: SitePhoto[],
  redirected: string[] = [],
): Promise<PlannedImage[]> {
  const cover = draft.meta.cover;
  const photos = new Map<string, string>();
  if (cover?.path) {
    photos.set(cover.path, cover.alt || (isLocalSrc(cover.path) ? "cover" : ""));
  }
  for (const [src, alt] of collectImages(draft.doc)) {
    if (!photos.has(src)) {
      photos.set(src, alt);
    }
  }
  const remote = [...photos.keys()].filter((src) => !isLocalSrc(src));
  const taken = new Set(
    [...site.map((photo) => photo.name), ...redirected, ...remote.map((src) => fileOf(src, dir) ?? "")].map(stem),
  );
  taken.delete("");

  const renames: PlannedImage[] = [];
  for (const src of remote) {
    const file = fileOf(src, dir);
    const words = altSlug(photos.get(src) ?? "");
    const found = file && words ? (site.find((photo) => photo.name === file) ?? site.find((photo) => stem(photo.name) === stem(file))) : undefined;
    const name = found ? stem(found.name) : "";
    const named = `${slug}-${words}`;
    if (found && name !== named && !(name.startsWith(`${named}-`) && /^\d+$/.test(name.slice(named.length + 1)))) {
      renames.push({ src, baseName: "", site: found });
    }
  }
  for (const rename of renames) {
    rename.baseName = photoName(slug, photos.get(rename.src) ?? "", taken);
  }

  const planned = renames;
  for (const [src, alt] of photos) {
    if (isLocalSrc(src)) {
      planned.push({ src, alt, baseName: photoName(slug, alt, taken), stored: await imageStore.get(localId(src)) });
    }
  }
  return planned;
}

function metaWithCover(draft: Draft, imageUrls: Map<string, string>) {
  const cover = draft.meta.cover;
  if (!cover?.path) {
    return draft.meta;
  }
  const resolved = imageUrls.get(cover.path) ?? (isLocalSrc(cover.path) ? undefined : cover.path);
  return { ...draft.meta, cover: resolved ? { ...cover, path: resolved } : null };
}

function imagePaths(settings: Settings): { dir: string; url: string } {
  const dir = trimSlashes(settings.imagesDir);
  return { dir, url: dir.replace(/^public\//, "") };
}

function markdownPathFor(draft: Draft, settings: Settings, slug: string): string {
  const dir = trimSlashes(settings.publishTarget === "drafts" ? settings.draftsDir : settings.postsDir);
  return `${dir}/${datePrefix(draft.meta.date)}-${slug}.md`;
}

export function leavesDraft(draft: Draft, settings: Settings, markdownPath: string): boolean {
  return Boolean(draft.publishedPath?.startsWith(`${trimSlashes(settings.draftsDir)}/`)) && draft.publishedPath !== markdownPath;
}

export async function markdownForExport(draft: Draft, settings: Settings): Promise<string> {
  const slug = draftSlug(draft);
  const images = imagePaths(settings);
  const imageUrls = new Map<string, string>();

  for (const image of await planImages(draft, slug, images.url, [])) {
    if (image.stored) {
      const extension = extensionFor(image.stored.type, image.stored.name);
      imageUrls.set(image.src, `/${images.url}/${image.baseName}.${extension}`);
    }
  }

  return buildPostFile(metaWithCover(draft, imageUrls), draft.doc, {
    resolveImage: (src) => imageUrls.get(src) ?? src,
  });
}

export async function buildPublishPlan(draft: Draft, settings: Settings): Promise<PublishPlan> {
  const slug = draftSlug(draft);
  const images = imagePaths(settings);
  const photos: PublishPlan["photos"] = [];
  const renames: PublishPlan["renames"] = [];
  const remove: string[] = [];
  const redirects: [string, string][] = [];
  const moved: [string, string][] = [];
  const imageUrls = new Map<string, string>();
  const skippedImages: string[] = [];
  const markdownPath = markdownPathFor(draft, settings, slug);
  const leaves = leavesDraft(draft, settings, markdownPath);
  const own = leaves && draft.publishedPath ? [markdownPath, draft.publishedPath] : [markdownPath];
  const any = Boolean(draft.meta.cover?.path) || collectImages(draft.doc).size > 0;

  const site = any ? await fetchSitePhotos(own) : { files: [], redirected: [] };
  for (const image of await planImages(draft, slug, images.url, site.files, site.redirected)) {
    if (image.site) {
      const file = `${image.baseName}${/\.[^.]*$/.exec(image.site.name)?.[0] ?? ""}`;
      renames.push({ path: `${images.dir}/${file}`, sha: image.site.sha });
      if (!image.site.shared) {
        remove.push(`${images.dir}/${image.site.name}`);
        redirects.push([image.site.name, file].map((name) => `/${images.url}/${encodeURIComponent(servedName(name))}`) as [string, string]);
      }
      moved.push([image.site.name, file]);
      imageUrls.set(image.src, `/${images.url}/${file}`);
      continue;
    }
    if (!image.stored) {
      skippedImages.push(image.src);
      continue;
    }
    const file = `${image.baseName}.${extensionFor(image.stored.type, image.stored.name)}`;
    photos.push({ path: `${images.dir}/${file}`, blob: image.stored.blob, src: image.src, alt: image.alt ?? "" });
    imageUrls.set(image.src, `/${images.url}/${file}`);
  }

  const markdown = buildPostFile(metaWithCover(draft, imageUrls), draft.doc, {
    resolveImage: (src) => imageUrls.get(src) ?? src,
  });
  if (leaves) {
    remove.push(draft.publishedPath!);
  }
  const source = draft.publishedPath && draft.publishedSha && (draft.publishedPath === markdownPath || leaves)
    ? [{ path: draft.publishedPath, sha: draft.publishedSha }]
    : [];
  const expect = [...(draft.publishedPath === markdownPath ? [] : [{ path: markdownPath, sha: "" }]), ...source];
  const warnings = warningsFor(draft, photos, skippedImages, !draft.publishedPath || source.length > 0);
  return {
    slug,
    markdownPath,
    markdown,
    photos,
    renames,
    remove,
    redirects,
    moved,
    imageUrls,
    skippedImages,
    warnings,
    expect: expect.length ? expect : undefined,
  };
}

export async function sendPlan(
  plan: PublishPlan,
  message: string,
  password: string,
  progress: (done: number) => void,
  signal?: AbortSignal,
): Promise<PublishResult> {
  const big = plan.photos.find((photo) => tooBig(photo.blob));
  if (big) {
    throw new Error(`${fileName(big.path)} is ${megabytes(big.blob.size)}; one photo can be ${megabytes(MAX_UPLOAD_BYTES)} at most.`);
  }
  const uploaded = [];
  for (const photo of plan.photos) {
    progress(uploaded.length);
    signal?.throwIfAborted();
    const sha = await uploadPhoto(await blobToBase64(await shrinkImage(photo.blob)), password, signal);
    uploaded.push({ path: photo.path, sha });
  }
  progress(uploaded.length);
  signal?.throwIfAborted();
  const markdown = { path: plan.markdownPath, contentBase64: await blobToBase64(new Blob([plan.markdown])) };
  return publish(
    {
      message,
      files: [markdown, ...uploaded, ...plan.renames],
      expect: plan.expect,
      remove: plan.remove,
      redirects: plan.redirects,
    },
    password,
  );
}

export async function printOf(markdown: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(markdown));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function draftPrint(draft: Pick<Draft, "meta" | "doc">): Promise<string> {
  return printOf(buildPostFile(draft.meta, draft.doc));
}

export function repointDoc(doc: JSONContent, urls: Map<string, string>): JSONContent {
  const src = doc.type === "image" ? doc.attrs?.src : undefined;
  const url = typeof src === "string" ? urls.get(src) : undefined;
  const node = url ? { ...doc, attrs: { ...doc.attrs, src: url } } : doc;
  return node.content ? { ...node, content: node.content.map((child) => repointDoc(child, urls)) } : node;
}

export function repointCover(meta: PostMeta, urls: Map<string, string>): PostMeta {
  const url = meta.cover?.path ? urls.get(meta.cover.path) : undefined;
  return url && meta.cover ? { ...meta, cover: { ...meta.cover, path: url } } : meta;
}

export function defaultCommitMessage(draft: Draft, isUpdate: boolean): string {
  const title = draft.meta.title || draft.title || "untitled";
  return `docs(post): ${isUpdate ? "update" : "add"} ${title}`;
}
