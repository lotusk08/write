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

export function frontMatter(text: string): { yaml: string; rest: string } | null {
  const front = splitFront(text);
  if (!front?.body || !/^\ufeff?---\r?\n$/.test(front.open)) {
    return null;
  }
  return { yaml: front.body.replace(/\r?\n$/, ""), rest: front.rest };
}

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
