/**
 * Where the blog is published. Images already on the blog are written as
 * site-absolute paths like `/assets/img/post/cover.webp`, which would resolve
 * against this app's own origin — where they do not exist. Previews point at
 * the live site instead, so an imported post looks like the post.
 */

let site = "";

export function setSiteUrl(url: string): void {
  site = url.trim().replace(/\/+$/, "");
}

export function siteUrl(): string {
  return site;
}

/**
 * The URL to show an image at. Only site-absolute paths are redirected —
 * `local:` sources, data URIs and full URLs are left exactly as they are.
 */
export function displaySrc(src: string): string {
  if (!site || !src.startsWith("/") || src.startsWith("//")) {
    return src;
  }
  return site + src;
}
