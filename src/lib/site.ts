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

const PREVIEW_WIDTH = 960;

export function previewSrc(src: string): string {
  const path = src.startsWith("/") && !src.startsWith("//") ? convertedSrc(src) : src;
  const rest = /^\/assets\/img\/(?!resized\/)([^?#]+\.(?:jpe?g|png|webp|tiff?))$/i.exec(path)?.[1];
  if (!site || shown.has(src) || !rest) {
    return shown.get(src) ?? siteSrc(path);
  }
  return `${site}/assets/img/resized/${PREVIEW_WIDTH}/${/\.webp$/i.test(rest) ? rest : `${rest}.webp`}`;
}

export function fullSrc(url: string): string {
  const original = originalSrc(url);
  return original === url ? url : siteSrc(original);
}

export function originalSrc(src: string): string {
  const path = site && src.startsWith(`${site}/`) ? src.slice(site.length) : src;
  const copy = /^\/assets\/img\/resized\/\d+\/([^?#]+?)(\.(?:jpe?g|png|gif|avif|tiff?))?\.webp([?#].*)?$/i.exec(path);
  return copy ? `/assets/img/${copy[1]}${copy[2] ?? ".webp"}${copy[3] ?? ""}` : src;
}
