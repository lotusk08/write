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

export function servedName(name: string): string {
  return name.replace(CONVERTED, ".webp");
}
