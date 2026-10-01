let site = "";
const shown = new Map<string, string>();

export function setSiteUrl(url: string): void {
  site = url.trim().replace(/\/+$/, "");
}

export function siteUrl(): string {
  return site;
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
