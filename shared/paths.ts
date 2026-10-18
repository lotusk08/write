const CONVERTED = /\.(jpe?g|png|tiff?|bmp)$/i;

export function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

export function stem(name: string): string {
  return name.replace(/\.[^.]*$/, "").toLowerCase();
}

export function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The day in a post's file name, `2026-10-11` in `src/posts/2026-10-11-trip.md`, or empty when it has none. */
export function fileDate(path: string): string {
  return /(\d{4}-\d{2}-\d{2})-[^/]*$/.exec(path)?.[1] ?? "";
}

export function servedName(name: string): string {
  return name.replace(CONVERTED, ".webp");
}
