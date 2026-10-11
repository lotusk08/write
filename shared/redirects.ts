export const REDIRECTS_PATH = "src/redirects.txt";

function read(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [from, to] = line.trim().split(/\s+/);
    if (from && to) {
      map.set(from, to);
    }
  }
  return map;
}

export function redirectSources(text: string): string[] {
  return [...read(text).keys()];
}

export function mergeRedirects(text: string, moves: [string, string][], created: string[]): string {
  const map = read(text);
  for (const [from, to] of moves) {
    for (const [source, target] of map) {
      if (target === from) {
        map.set(source, to);
      }
    }
    map.set(from, to);
  }
  for (const path of created) {
    map.delete(path);
  }
  const lines = [...map].filter(([from, to]) => from !== to).map(([from, to]) => `${from} ${to}`).sort();
  return lines.length ? `${lines.join("\n")}\n` : "";
}
