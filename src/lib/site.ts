let site = "";
const shown = new Map<string, string>();

export function setSiteUrl(url: string): void {
  site = url.trim().replace(/\/+$/, "");
}

export function showPublishedAs(src: string, url: string): void {
  shown.set(src, url);
}

export function siteSrc(src: string): string {
  if (!site || !src.startsWith("/") || src.startsWith("//")) {
    return src;
  }
  return site + src;
}

export function displaySrc(src: string): string {
  return shown.get(src) ?? siteSrc(src);
}

export function convertedSrc(src: string): string {
  return src.replace(/(\/assets\/img\/post\/[^?#]+)\.(?:jpe?g|png|tiff?)$/i, "$1.webp");
}

export function previewSrc(src: string): string {
  return shown.get(src) ?? siteSrc(convertedSrc(src));
}

export function originalSrc(src: string): string {
  const path = site && src.startsWith(`${site}/`) ? src.slice(site.length) : src;
  const copy = /^\/assets\/img\/resized\/\d+\/([^?#]+?)(\.(?:jpe?g|png|tiff?))?\.webp$/i.exec(path);
  return copy ? `/assets/img/${copy[1]}${copy[2] ?? ".webp"}` : src;
}
