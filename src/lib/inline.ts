import markdownit from "markdown-it";

/**
 * What the reader, markdown-it as the blog sets it up, reads as a link or an entity in plain text: the writer escapes
 * these so text typed in the editor stays text.
 */

const SCHEME = /(?:^|[^a-z0-9.+-])([a-z][a-z0-9.+-]*)$/i;
// eslint-disable-next-line no-control-regex -- control characters are what this matches
const AUTOLINK = /^([a-z][a-z0-9+.-]{1,31}):([^<>\x00-\x20]*)$/i;
const EMAIL =
  /^([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/;
const ZCC = "[\\p{Z}\\p{Cc}]";
const ZPCC = "[\\p{Z}\\p{P}\\p{Cc}]";
const SEPARATORS = "[><\\uff5c]";
const LETTER = `(?:(?!${SEPARATORS}|${ZPCC})[\\s\\S])`;
// linkify-it also lists `xn--…` labels on their own; the last form already takes them, and the overlap backtracked
// exponentially, seconds on a line of two dozen `xn--a.` labels.
const DOMAIN = `(?:${LETTER}|${LETTER}(?:-|${LETTER}){0,61}${LETTER})`;
const PATH =
  "(?:[/?#](?:" +
  `(?!${ZCC}|${SEPARATORS}|[()[\\]{}.,"'?!\\-;]).|` +
  `\\[(?:(?!${ZCC}|\\]).)*\\]|` +
  `\\((?:(?!${ZCC}|[)]).)*\\)|` +
  `\\{(?:(?!${ZCC}|[}]).)*\\}|` +
  `"(?:(?!${ZCC}|["]).)+"|` +
  `'(?:(?!${ZCC}|[']).)+'|` +
  `'(?=${LETTER}|[-])|` +
  "\\.{2,}[a-zA-Z0-9%/&]|" +
  `\\.(?!${ZCC}|[.]|$)|` +
  "-+|" +
  `,(?!${ZCC}|$)|` +
  `;(?!${ZCC}|$)|` +
  `!+(?!${ZCC}|[!]|$)|` +
  `\\?(?!${ZCC}|[?]|$)` +
  ")+|\\/)?";
const WEB = new RegExp(
  `^\\/\\/(?:(?:(?!${ZCC}|[@/\\[\\]()]).){1,50}@)?` +
    `(?:(?:(?:${DOMAIN})\\.)*${DOMAIN})` +
    "(?::(?:6(?:[0-4]\\d{3}|5(?:[0-4]\\d{2}|5(?:[0-2]\\d|3[0-5])))|[1-5]?\\d{1,4}))?" +
    `(?=$|${SEPARATORS}|${ZPCC})(?!-|_|:\\d|\\.-|\\.(?!$|${ZPCC}))` +
    PATH,
  "iu",
);
const WEB_SCHEME = /^(https?:|ftp:)/i;
const CORE_PREFIX = /^[><\uff5c\p{Z}\p{P}\p{Cc}]$/u;

export function autolinkFor(text: string, href: string): boolean {
  return (href === text && AUTOLINK.test(text)) || (href === `mailto:${text}` && !AUTOLINK.test(text) && EMAIL.test(text));
}

function webLinkAt(text: string, trim = true): string | null {
  const scheme = WEB_SCHEME.exec(text);
  const tail = scheme ? WEB.exec(text.slice(scheme[0].length)) : null;
  if (!scheme || !tail) {
    return null;
  }
  const url = text.slice(0, scheme[0].length + tail[0].length);
  return trim ? url.replace(/\*+$/, "") : url;
}

export function bareLinks(text: string): { start: number; end: number; inline: boolean }[] {
  const found: { start: number; end: number; inline: boolean }[] = [];
  let from = 0;
  for (let at = text.indexOf("://"); at !== -1; at = text.indexOf("://", Math.max(at + 1, from))) {
    const proto = SCHEME.exec(text.slice(from, at))?.[1];
    const url = proto ? webLinkAt(text.slice(at - proto.length)) : null;
    if (proto && url && url.length > proto.length) {
      found.push({ start: at - proto.length, end: at - proto.length + url.length, inline: true });
      from = at - proto.length + url.length;
      continue;
    }
    const scheme = /(?:https?|ftp)$/i.exec(text.slice(from, at))?.[0];
    const before = scheme ? text[at - scheme.length - 1] : undefined;
    const core = scheme && (before === undefined || (before !== "_" && CORE_PREFIX.test(before)));
    const link = core ? webLinkAt(text.slice(at - scheme.length), false) : null;
    if (scheme && link) {
      found.push({ start: at - scheme.length, end: at - scheme.length + link.length, inline: false });
      from = at - scheme.length + link.length;
    }
  }
  return found;
}

const ASCII_PUNCTUATION = "!-/:-@[-`{-~";
export function escapeChars(text: string, chars: string): string {
  return text.replace(new RegExp(`\\\\(?=[${ASCII_PUNCTUATION}]|$)|[${chars.replace(/[\\\]^-]/g, "\\$&")}]`, "g"), "\\$&");
}

export const ENTITY = /^&(?:#[xX]([0-9a-fA-F]{1,6})|#(\d{1,7})|([a-zA-Z][a-zA-Z0-9]{1,31}));/;

const { fromCodePoint, isValidEntityCode, unescapeAll } = markdownit().utils;

/** The character an entity stands for, as markdown-it reads it, or null when it reads the text as written. */
export function entityText(match: RegExpExecArray): string | null {
  const [whole, hex, decimal] = match;
  if (hex ?? decimal) {
    const code = parseInt(hex ?? decimal, hex ? 16 : 10);
    return fromCodePoint(isValidEntityCode(code) ? code : 0xfffd);
  }
  const decoded = unescapeAll(whole);
  return decoded === whole ? null : decoded;
}
