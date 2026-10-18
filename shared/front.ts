/**
 * A post's front matter, cut so the file can be put back together byte for byte: the opening `---` line, with the
 * byte-order mark before it if there is one, the lines between, each with its line end, and the closing `---` line.
 */
const FRONT = /^(\ufeff?---[^\S\n]*\r?\n)([\s\S]*?\r?\n)?(---[^\S\n]*(?:\r?\n|$))/;

export interface Front {
  open: string;
  body: string;
  close: string;
  rest: string;
}

export function splitFront(text: string): Front | null {
  const found = FRONT.exec(text);
  return found ? { open: found[1], body: found[2] ?? "", close: found[3], rest: text.slice(found[0].length) } : null;
}

/**
 * The YAML of a post's front matter as the editor and the Worker read it, and the text after it. They take none where
 * `splitFront` still finds some: an opening line with more than `---` on it, or no line before the closing one.
 */
export function frontMatter(text: string): { yaml: string; rest: string } | null {
  const front = splitFront(text);
  if (!front?.body || !/^\ufeff?---\r?\n$/.test(front.open)) {
    return null;
  }
  return { yaml: front.body.replace(/\r?\n$/, ""), rest: front.rest };
}
