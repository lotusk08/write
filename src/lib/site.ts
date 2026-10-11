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
  const rest = /^\/assets\/img\/(?!resized\/)([^?#]+\.(?:jpe?g|png|webp|tiff?))$/i.exec(convertedSrc(src))?.[1];
  if (!site || shown.has(src) || !rest) {
    return displaySrc(src);
  }
  return `${site}/assets/img/resized/960/${/\.webp$/i.test(rest) ? rest : `${rest}.webp`}`;
}

export function fullSrc(url: string): string {
  return url.replace(/\/assets\/img\/resized\/\d+\/([^?#]+?)(\.(?:jpe?g|png|tiff?))?\.webp$/i, (_, rest: string, ext?: string) =>
    `/assets/img/${rest}${ext ?? ".webp"}`,
  );
}
