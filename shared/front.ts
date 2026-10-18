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

/** A scalar written in quotes, read as YAML reads it; a double-quoted one as JSON, which it is but for rare escapes. */
export function yamlScalar(value: string): string {
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value.startsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : value;
}

const QUOTED = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')/;

/**
 * A top-level field's scalar, read as the blog's YAML reads it for the fields the site's list shows: quoted or plain,
 * a comment after it left out, written on the key's line or on the indented line under it. Null when it is not there.
 */
export function frontField(yaml: string, key: string): { text: string; plain: boolean } | null {
  const lines = yaml.split(/\r?\n/);
  const at = lines.findIndex((line) => line.startsWith(`${key}:`) && /^(?:[ \t]|$)/.test(line.slice(key.length + 1)));
  if (at === -1) {
    return null;
  }
  let raw = lines[at].slice(key.length + 1).trim();
  if (!raw || raw.startsWith("#")) {
    raw = /^[ \t]+(\S.*)$/.exec(lines[at + 1] ?? "")?.[1] ?? "";
  }
  const quoted = QUOTED.exec(raw)?.[0];
  if (quoted) {
    return { text: yamlScalar(quoted), plain: false };
  }
  const text = raw.replace(/(?:^|[ \t])#.*$/, "").trim();
  return text ? { text, plain: true } : null;
}
