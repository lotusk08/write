let site = "";

export function setSiteUrl(url: string): void {
  site = url.trim().replace(/\/+$/, "");
}

export function siteUrl(): string {
  return site;
}

export function displaySrc(src: string): string {
  if (!site || !src.startsWith("/") || src.startsWith("//")) {
    return src;
  }
  return site + src;
}
