import { NOTE_CLASSES, pandocAttributes } from "../editor/blog.ts";

const KINDS = new Set(Object.values(NOTE_CLASSES));
const FENCE = /^((?:\s*>)*\s*)(`{3,}|~{3,})/;
const NOTE_LINE = /^(\s*)\{:\s*\.([\w-]+)\s*\}\s*$/;
const ENDS_QUOTE = /^\s*(?:<[a-zA-Z!/]|\{:|([-*_=])(\s*\1){2,}\s*$)/;
const OPENS_BLOCK = /^\s*(?:<[a-zA-Z!/]|\{:|([-*_=])(\s*\1){2,}\s*$|[-*+] |\d+[.)] )/;

/** A line with the text outside its code spans changed by `change`, the spans as written. */
function outsideCode(line: string, change: (text: string) => string): string {
  let out = "";
  let at = 0;
  const runs = [...line.matchAll(/`+/g)];
  for (let k = 0; k < runs.length; k++) {
    const close = runs.findIndex((other, j) => j > k && other[0].length === runs[k][0].length);
    if (close === -1 || runs[k].index < at) {
      continue;
    }
    out += change(line.slice(at, runs[k].index)) + line.slice(runs[k].index, runs[close].index + runs[close][0].length);
    at = runs[close].index + runs[close][0].length;
    k = close;
  }
  return out + change(line.slice(at));
}

/**
 * The quote a list under it names: the last quote in the lines run together above, when every line after it is the
 * quote's own or one it takes lazily, as a quote takes a line (not a rule, block HTML or a fence).
 */
function quoteAbove(lines: string[], code: Set<number>, at: number, indent: number): { start: number; indent: string } | null {
  let start = -1;
  let lead = "";
  for (let back = at - 1; back >= 0 && lines[back].trim() && !code.has(back); back--) {
    const quoted = /^(\s*)>/.exec(lines[back]);
    if (quoted && quoted[1].length <= indent && indent - quoted[1].length <= 3) {
      start = back;
      lead = quoted[1];
    } else if ((quoted || ENDS_QUOTE.test(lines[back])) && start === -1) {
      return null;
    }
  }
  if (start === -1) {
    return null;
  }
  for (let line = start; line < at; line++) {
    if (!lines[line].startsWith(`${lead}>`) && OPENS_BLOCK.test(lines[line])) {
      return null;
    }
  }
  return { start, indent: lead };
}

/**
 * Markdown written for the blog's older reader, kramdown's, in the forms it reads now; code blocks and code spans as
 * written.
 *
 *   > text            > [!info]
 *   {: .info}    →    > text
 *
 *   `a.ts`{: .path}   →   `a.ts`{.path}
 */
export function upgradeSyntax(markdown: string): string {
  if (!markdown.includes("{:")) {
    return markdown;
  }
  const lines = markdown.split("\n");
  const code = new Set<number>();
  let fence: string | null = null;
  lines.forEach((line, at) => {
    const found = FENCE.exec(line);
    if (fence) {
      code.add(at);
      if (found && found[2][0] === fence[0] && found[2].length >= fence.length && !line.slice(found[0].length).trim()) {
        fence = null;
      }
    } else if (found) {
      code.add(at);
      fence = found[2];
    }
  });

  const out: (string | null)[] = [...lines];
  const marks = new Map<number, string>();
  for (let at = 0; at < lines.length; at++) {
    if (code.has(at)) {
      continue;
    }
    const note = NOTE_LINE.exec(lines[at]);
    const quote = note && KINDS.has(note[2]) ? quoteAbove(lines, code, at, note[1].length) : null;
    if (quote) {
      marks.set(quote.start, `${quote.indent}> [!${note![2]}]`);
      // The list's line kept the quote from taking the line under it as its own; a blank line does that now.
      out[at] = lines[at + 1]?.trim() ? "" : null;
      continue;
    }
    out[at] = outsideCode(lines[at], pandocAttributes);
  }
  return out
    .flatMap((line, at) => [...(marks.has(at) ? [marks.get(at)!] : []), ...(line === null ? [] : [line])])
    .join("\n");
}
