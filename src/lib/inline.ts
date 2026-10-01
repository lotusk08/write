export interface InlineToken {
  type: string;
  content: string;
  nesting: number;
  level: number;
  markup: string;
  attrs?: Record<string, string>;
  start?: number;
  end?: number;
}

interface Delimiter {
  marker: number;
  length: number;
  token: number;
  end: number;
  open: boolean;
  close: boolean;
}

interface State {
  src: string;
  pos: number;
  posMax: number;
  level: number;
  pending: string;
  pendingLevel: number;
  tokens: InlineToken[];
  meta: (Delimiter[] | null)[];
  delimiters: Delimiter[];
  previous: Delimiter[][];
  cache: Map<number, number>;
  backticks: Record<number, number>;
  backticksScanned: boolean;
  linkLevel: number;
}

type Rule = (state: State, silent: boolean) => boolean;

const PUNCTUATION = /[\p{P}\p{S}]/u;
const TERMINATORS = new Set("\n!#$%&*+-:<=>@[\\]^_`{}~".split("").map((char) => char.charCodeAt(0)));
const ESCAPABLE = new Set("\\!\"#$%&'()*+,./:;<=>?@[]^_`{|}~-".split("").map((char) => char.charCodeAt(0)));
const SCHEME = /(?:^|[^a-z0-9.+-])([a-z][a-z0-9.+-]*)$/i;
const SPACED_LINK = /^\]\(([^()<>\n"']*\s[^()<>\n"']*)\)/;
const AUTOLINK = /^([a-z][a-z0-9+.-]{1,31}):([^<>\x00-\x20]*)$/i;
const EMAIL =
  /^([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/;
const ATTRIBUTE = "(?:\\s+[a-zA-Z_:@][a-zA-Z0-9:._-]*(?:\\s*=\\s*(?:[^\"'=<>`\\x00-\\x20]+|'[^']*'|\"[^\"]*\"))?)";
const HTML_TAG = new RegExp(
  `^(?:<[A-Za-z][A-Za-z0-9\\-]*${ATTRIBUTE}*\\s*\\/?>|<\\/[A-Za-z][A-Za-z0-9\\-]*\\s*>|<!---->|<!--(?:-?[^>-])(?:-?[^-])*-->|<[?][\\s\\S]*?[?]>|<![A-Z]+\\s+[^>]*>|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>)`,
);
const BAD_PROTOCOL = /^(vbscript|javascript|file|data):/;
const GOOD_DATA = /^data:image\/(gif|png|jpeg|webp);/;
const FILEPATH = /^\{:\s*\.filepath\s*\}/;

const ZCC = "[\\p{Z}\\p{Cc}]";
const ZPCC = "[\\p{Z}\\p{P}\\p{Cc}]";
const SEPARATORS = "[><\\uff5c]";
const LETTER = `(?:(?!${SEPARATORS}|${ZPCC})[\\s\\S])`;
const DOMAIN = `(?:xn--[a-z0-9\\-]{1,59}|${LETTER}|${LETTER}(?:-|${LETTER}){0,61}${LETTER})`;
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

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09;
}

function isWhiteSpace(code: number): boolean {
  return (
    (code >= 0x2000 && code <= 0x200a) ||
    [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x202f, 0x205f, 0x3000].includes(code)
  );
}

function isPunctuation(code: number): boolean {
  return PUNCTUATION.test(String.fromCodePoint(code));
}

function validLink(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return BAD_PROTOCOL.test(lower) ? GOOD_DATA.test(lower) : true;
}

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

function token(type: string, nesting = 0): InlineToken {
  return { type, content: "", nesting, level: 0, markup: "" };
}

function pushPending(state: State): void {
  const text = token("text");
  text.content = state.pending;
  text.level = state.pendingLevel;
  state.tokens.push(text);
  state.meta.push(null);
  state.pending = "";
}

function push(state: State, type: string, nesting: number): InlineToken {
  if (state.pending) {
    pushPending(state);
  }
  const pushed = token(type, nesting);
  let meta: Delimiter[] | null = null;
  if (nesting < 0) {
    state.level -= 1;
    state.delimiters = state.previous.pop() ?? [];
  }
  pushed.level = state.level;
  if (nesting > 0) {
    state.level += 1;
    state.previous.push(state.delimiters);
    state.delimiters = [];
    meta = state.delimiters;
  }
  state.pendingLevel = state.level;
  state.tokens.push(pushed);
  state.meta.push(meta);
  return pushed;
}

function codePointBefore(src: string, at: number): number {
  if (at === 0) {
    return 0x20;
  }
  const code = src.charCodeAt(at - 1);
  if (at === 1) {
    return (code & 0xf800) === 0xd800 ? 0xfffd : code;
  }
  if ((code & 0xfc00) === 0xdc00) {
    const high = src.charCodeAt(at - 2);
    return (high & 0xfc00) === 0xd800 ? 0x10000 + ((high - 0xd800) << 10) + (code - 0xdc00) : 0xfffd;
  }
  return (code & 0xfc00) === 0xd800 ? 0xfffd : code;
}

function codePointAt(src: string, at: number, max: number): number {
  if (at >= max) {
    return 0x20;
  }
  const code = src.charCodeAt(at);
  if ((code & 0xfc00) === 0xd800) {
    const low = src.charCodeAt(at + 1);
    return (low & 0xfc00) === 0xdc00 ? 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00) : 0xfffd;
  }
  return (code & 0xfc00) === 0xdc00 ? 0xfffd : code;
}

function scanDelims(state: State, start: number, canSplitWord: boolean) {
  const marker = state.src.charCodeAt(start);
  const last = codePointBefore(state.src, start);
  let pos = start;
  while (pos < state.posMax && state.src.charCodeAt(pos) === marker) {
    pos += 1;
  }
  const next = codePointAt(state.src, pos, state.posMax);
  const lastPunct = isPunctuation(last);
  const nextPunct = isPunctuation(next);
  const lastSpace = isWhiteSpace(last);
  const nextSpace = isWhiteSpace(next);
  const left = !nextSpace && (!nextPunct || lastSpace || lastPunct);
  const right = !lastSpace && (!lastPunct || nextSpace || nextPunct);
  return {
    open: left && (canSplitWord || !right || lastPunct),
    close: right && (canSplitWord || !left || nextPunct),
    length: pos - start,
  };
}

const text: Rule = (state, silent) => {
  let pos = state.pos;
  while (pos < state.posMax && !TERMINATORS.has(state.src.charCodeAt(pos))) {
    pos += 1;
  }
  if (pos === state.pos) {
    return false;
  }
  if (!silent) {
    state.pending += state.src.slice(state.pos, pos);
  }
  state.pos = pos;
  return true;
};

const linkify: Rule = (state, silent) => {
  const { src, pos } = state;
  if (state.linkLevel > 0 || pos + 3 > state.posMax || !src.startsWith("://", pos)) {
    return false;
  }
  const proto = SCHEME.exec(state.pending)?.[1];
  if (!proto) {
    return false;
  }
  const url = webLinkAt(src.slice(pos - proto.length));
  if (!url || url.length <= proto.length) {
    return false;
  }
  if (!silent) {
    state.pending = state.pending.slice(0, -proto.length);
    const open = push(state, "link_open", 1);
    open.markup = "linkify";
    open.attrs = { href: url };
    push(state, "text", 0).content = url;
    push(state, "link_close", -1).markup = "linkify";
  }
  state.pos += url.length - proto.length;
  return true;
};

const newline: Rule = (state, silent) => {
  let pos = state.pos;
  if (state.src.charCodeAt(pos) !== 0x0a) {
    return false;
  }
  if (!silent) {
    const last = state.pending.length - 1;
    if (last >= 0 && state.pending.charCodeAt(last) === 0x20) {
      if (last >= 1 && state.pending.charCodeAt(last - 1) === 0x20) {
        let ws = last - 1;
        while (ws >= 1 && state.pending.charCodeAt(ws - 1) === 0x20) {
          ws -= 1;
        }
        state.pending = state.pending.slice(0, ws);
        push(state, "hardbreak", 0);
      } else {
        state.pending = state.pending.slice(0, -1);
        push(state, "softbreak", 0);
      }
    } else {
      push(state, "softbreak", 0);
    }
  }
  pos += 1;
  while (pos < state.posMax && isSpace(state.src.charCodeAt(pos))) {
    pos += 1;
  }
  if (!silent) {
    state.tokens[state.tokens.length - 1].content = state.src.slice(state.pos + 1, pos);
  }
  state.pos = pos;
  return true;
};

const escape: Rule = (state, silent) => {
  let pos = state.pos;
  if (state.src.charCodeAt(pos) !== 0x5c) {
    return false;
  }
  pos += 1;
  if (pos >= state.posMax) {
    return false;
  }
  const code = state.src.charCodeAt(pos);
  if (code === 0x0a) {
    const indent = /^[ \t]*/.exec(state.src.slice(pos + 1, state.posMax))![0];
    if (!silent) {
      push(state, "hardbreak", 0).content = indent;
    }
    state.pos = pos + 1 + indent.length;
    return true;
  }
  if (code === 0x20) {
    if (!silent) {
      push(state, "text_special", 0).content = "\\";
    }
    state.pos = pos;
    return true;
  }
  let escaped = state.src[pos];
  if (code >= 0xd800 && code <= 0xdbff && pos + 1 < state.posMax) {
    const low = state.src.charCodeAt(pos + 1);
    if (low >= 0xdc00 && low <= 0xdfff) {
      escaped += state.src[pos + 1];
      pos += 1;
    }
  }
  if (!silent) {
    push(state, "text_special", 0).content = code < 256 && ESCAPABLE.has(code) ? escaped : `\\${escaped}`;
  }
  state.pos = pos + 1;
  return true;
};

const backtick: Rule = (state, silent) => {
  const { src } = state;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x60) {
    return false;
  }
  const max = state.posMax;
  let pos = start + 1;
  while (pos < max && src.charCodeAt(pos) === 0x60) {
    pos += 1;
  }
  const marker = src.slice(start, pos);
  const length = marker.length;
  if (state.backticksScanned && (state.backticks[length] || 0) <= start) {
    if (!silent) {
      state.pending += marker;
    }
    state.pos += length;
    return true;
  }
  let matchEnd = pos;
  for (;;) {
    const matchStart = src.indexOf("`", matchEnd);
    if (matchStart === -1) {
      break;
    }
    matchEnd = matchStart + 1;
    while (matchEnd < max && src.charCodeAt(matchEnd) === 0x60) {
      matchEnd += 1;
    }
    if (matchEnd - matchStart === length) {
      if (!silent) {
        const code = push(state, "code_inline", 0);
        code.markup = marker;
        code.content = src.slice(pos, matchStart);
        const tagged = FILEPATH.exec(src.slice(matchEnd, max));
        if (tagged) {
          code.attrs = { filepath: "true" };
          matchEnd += tagged[0].length;
        }
      }
      state.pos = matchEnd;
      return true;
    }
    state.backticks[matchEnd - matchStart] = matchStart;
  }
  state.backticksScanned = true;
  if (!silent) {
    state.pending += marker;
  }
  state.pos += length;
  return true;
};

const strikethrough: Rule = (state, silent) => {
  if (silent || state.src.charCodeAt(state.pos) !== 0x7e) {
    return false;
  }
  const scanned = scanDelims(state, state.pos, true);
  let length = scanned.length;
  if (length < 2) {
    return false;
  }
  if (length % 2) {
    push(state, "text", 0).content = "~";
    length -= 1;
  }
  for (let i = 0; i < length; i += 2) {
    push(state, "text", 0).content = "~~";
    state.delimiters.push({
      marker: 0x7e,
      length: 0,
      token: state.tokens.length - 1,
      end: -1,
      open: scanned.open,
      close: scanned.close,
    });
  }
  state.pos += scanned.length;
  return true;
};

const emphasis: Rule = (state, silent) => {
  const marker = state.src.charCodeAt(state.pos);
  if (silent || (marker !== 0x5f && marker !== 0x2a)) {
    return false;
  }
  const scanned = scanDelims(state, state.pos, marker === 0x2a);
  for (let i = 0; i < scanned.length; i++) {
    push(state, "text", 0).content = String.fromCharCode(marker);
    state.delimiters.push({
      marker,
      length: scanned.length,
      token: state.tokens.length - 1,
      end: -1,
      open: scanned.open,
      close: scanned.close,
    });
  }
  state.pos += scanned.length;
  return true;
};

function parseLinkLabel(state: State, start: number, disableNested: boolean): number {
  const max = state.posMax;
  const oldPos = state.pos;
  let level = 1;
  let found = false;
  state.pos = start + 1;
  while (state.pos < max) {
    const marker = state.src.charCodeAt(state.pos);
    if (marker === 0x5d) {
      level -= 1;
      if (level === 0) {
        found = true;
        break;
      }
    }
    const prevPos = state.pos;
    skipToken(state);
    if (marker === 0x5b) {
      if (prevPos === state.pos - 1) {
        level += 1;
      } else if (disableNested) {
        state.pos = oldPos;
        return -1;
      }
    }
  }
  const end = found ? state.pos : -1;
  state.pos = oldPos;
  return end;
}

function parseLinkDestination(src: string, start: number, max: number): { ok: boolean; pos: number; str: string } {
  let pos = start;
  if (src.charCodeAt(pos) === 0x3c) {
    pos += 1;
    while (pos < max) {
      const code = src.charCodeAt(pos);
      if (code === 0x0a || code === 0x3c) {
        return { ok: false, pos: 0, str: "" };
      }
      if (code === 0x3e) {
        return { ok: true, pos: pos + 1, str: src.slice(start + 1, pos) };
      }
      pos += code === 0x5c && pos + 1 < max ? 2 : 1;
    }
    return { ok: false, pos: 0, str: "" };
  }
  let level = 0;
  while (pos < max) {
    const code = src.charCodeAt(pos);
    if (code === 0x20 || code < 0x20 || code === 0x7f) {
      break;
    }
    if (code === 0x5c && pos + 1 < max) {
      if (src.charCodeAt(pos + 1) === 0x20) {
        break;
      }
      pos += 2;
      continue;
    }
    if (code === 0x28) {
      level += 1;
      if (level > 32) {
        return { ok: false, pos: 0, str: "" };
      }
    }
    if (code === 0x29) {
      if (level === 0) {
        break;
      }
      level -= 1;
    }
    pos += 1;
  }
  if (start === pos || level !== 0) {
    return { ok: false, pos: 0, str: "" };
  }
  return { ok: true, pos, str: src.slice(start, pos) };
}

function parseLinkTitle(src: string, start: number, max: number): { ok: boolean; pos: number } {
  let pos = start;
  if (pos >= max) {
    return { ok: false, pos: 0 };
  }
  let marker = src.charCodeAt(pos);
  if (marker !== 0x22 && marker !== 0x27 && marker !== 0x28) {
    return { ok: false, pos: 0 };
  }
  pos += 1;
  if (marker === 0x28) {
    marker = 0x29;
  }
  while (pos < max) {
    const code = src.charCodeAt(pos);
    if (code === marker) {
      return { ok: true, pos: pos + 1 };
    }
    if (code === 0x28 && marker === 0x29) {
      return { ok: false, pos: 0 };
    }
    if (code === 0x5c && pos + 1 < max) {
      pos += 1;
    }
    pos += 1;
  }
  return { ok: false, pos: 0 };
}

function skipSpace(src: string, pos: number, max: number): number {
  while (pos < max && (isSpace(src.charCodeAt(pos)) || src.charCodeAt(pos) === 0x0a)) {
    pos += 1;
  }
  return pos;
}

function target(state: State, labelEnd: number, image: boolean): number {
  const { src } = state;
  const max = state.posMax;
  let pos = labelEnd + 1;
  if (pos >= max || src.charCodeAt(pos) !== 0x28) {
    return -1;
  }
  const spaced = SPACED_LINK.exec(src.slice(labelEnd, max));
  if (spaced) {
    return labelEnd + spaced[0].length - 1;
  }
  pos = skipSpace(src, pos + 1, max);
  if (pos >= max) {
    return -1;
  }
  const destination = parseLinkDestination(src, pos, max);
  if (destination.ok || image) {
    if (destination.ok && validLink(destination.str)) {
      pos = destination.pos;
    }
    const start = pos;
    pos = skipSpace(src, pos, max);
    const title = parseLinkTitle(src, pos, max);
    if (pos < max && start !== pos && title.ok) {
      pos = skipSpace(src, title.pos, max);
    }
  }
  return pos < max && src.charCodeAt(pos) === 0x29 ? pos : -1;
}

function linkAttrs(inner: string): Record<string, string> {
  const quoted = /\s+"([^"]*)"\s*$/.exec(inner);
  const href = (quoted ? inner.slice(0, quoted.index) : inner).trim();
  return quoted?.[1] ? { href, title: quoted[1] } : { href };
}

const link: Rule = (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x5b) {
    return false;
  }
  const start = state.pos;
  const max = state.posMax;
  const labelEnd = parseLinkLabel(state, start, true);
  if (labelEnd < 0) {
    return false;
  }
  const close = target(state, labelEnd, false);
  if (close < 0) {
    return false;
  }
  if (!silent) {
    state.pos = start + 1;
    state.posMax = labelEnd;
    const open = push(state, "link_open", 1);
    open.attrs = linkAttrs(state.src.slice(labelEnd + 2, close));
    open.start = start;
    open.end = close + 1;
    state.linkLevel += 1;
    tokenize(state);
    state.linkLevel -= 1;
    push(state, "link_close", -1);
  }
  state.pos = close + 1;
  state.posMax = max;
  return true;
};

const image: Rule = (state, silent) => {
  const { src } = state;
  if (src.charCodeAt(state.pos) !== 0x21 || src.charCodeAt(state.pos + 1) !== 0x5b) {
    return false;
  }
  const labelStart = state.pos + 2;
  const labelEnd = parseLinkLabel(state, state.pos + 1, false);
  if (labelEnd < 0) {
    return false;
  }
  const close = target(state, labelEnd, true);
  if (close < 0) {
    return false;
  }
  if (!silent) {
    const { href, title } = linkAttrs(src.slice(labelEnd + 2, close));
    const found = push(state, "image", 0);
    found.attrs = { src: href, alt: src.slice(labelStart, labelEnd), ...(title ? { title } : {}) };
    found.start = labelStart - 2;
    found.end = close + 1;
  }
  state.pos = close + 1;
  return true;
};

const footnoteInline: Rule = (state, silent) => {
  const start = state.pos;
  if (
    start + 2 >= state.posMax ||
    state.src.charCodeAt(start) !== 0x5e ||
    state.src.charCodeAt(start + 1) !== 0x5b
  ) {
    return false;
  }
  const labelEnd = parseLinkLabel(state, start + 1, false);
  if (labelEnd < 0) {
    return false;
  }
  if (!silent) {
    push(state, "footnote_inline", 0).content = state.src.slice(start, labelEnd + 1);
  }
  state.pos = labelEnd + 1;
  return true;
};

const footnoteRef: Rule = (state, silent) => {
  const start = state.pos;
  const max = state.posMax;
  if (start + 3 > max || state.src.charCodeAt(start) !== 0x5b || state.src.charCodeAt(start + 1) !== 0x5e) {
    return false;
  }
  let pos = start + 2;
  for (; pos < max; pos++) {
    const code = state.src.charCodeAt(pos);
    if (code === 0x20 || code === 0x0a) {
      return false;
    }
    if (code === 0x5d) {
      break;
    }
  }
  if (pos === start + 2 || pos >= max) {
    return false;
  }
  if (!silent) {
    push(state, "footnote_ref", 0).content = state.src.slice(start + 2, pos);
  }
  state.pos = pos + 1;
  return true;
};

const autolink: Rule = (state, silent) => {
  let pos = state.pos;
  if (state.src.charCodeAt(pos) !== 0x3c) {
    return false;
  }
  for (;;) {
    pos += 1;
    if (pos >= state.posMax) {
      return false;
    }
    const code = state.src.charCodeAt(pos);
    if (code === 0x3c) {
      return false;
    }
    if (code === 0x3e) {
      break;
    }
  }
  const url = state.src.slice(state.pos + 1, pos);
  const email = !AUTOLINK.test(url) && EMAIL.test(url);
  if ((!email && !AUTOLINK.test(url)) || !validLink(email ? `mailto:${url}` : url)) {
    return false;
  }
  if (!silent) {
    const open = push(state, "link_open", 1);
    open.markup = "autolink";
    open.attrs = { href: email ? `mailto:${url}` : url };
    open.start = state.pos;
    open.end = pos + 1;
    push(state, "text", 0).content = url;
    push(state, "link_close", -1).markup = "autolink";
  }
  state.pos += url.length + 2;
  return true;
};

const htmlInline: Rule = (state, silent) => {
  const pos = state.pos;
  if (state.src.charCodeAt(pos) !== 0x3c || pos + 2 >= state.posMax) {
    return false;
  }
  const next = state.src.charCodeAt(pos + 1);
  const letter = (next | 32) >= 97 && (next | 32) <= 122;
  if (next !== 0x21 && next !== 0x3f && next !== 0x2f && !letter) {
    return false;
  }
  const match = HTML_TAG.exec(state.src.slice(pos));
  if (!match) {
    return false;
  }
  if (!silent) {
    push(state, "html_inline", 0).content = match[0];
  }
  state.pos += match[0].length;
  return true;
};

const RULES: Rule[] = [
  text,
  linkify,
  newline,
  escape,
  backtick,
  strikethrough,
  emphasis,
  link,
  image,
  footnoteInline,
  footnoteRef,
  autolink,
  htmlInline,
];

function skipToken(state: State): void {
  const pos = state.pos;
  const cached = state.cache.get(pos);
  if (cached !== undefined) {
    state.pos = cached;
    return;
  }
  let ok = false;
  for (const rule of RULES) {
    state.level += 1;
    ok = rule(state, true);
    state.level -= 1;
    if (ok) {
      break;
    }
  }
  if (!ok) {
    state.pos += 1;
  }
  state.cache.set(pos, state.pos);
}

function tokenize(state: State): void {
  const end = state.posMax;
  while (state.pos < end) {
    let ok = false;
    for (const rule of RULES) {
      ok = rule(state, false);
      if (ok) {
        break;
      }
    }
    if (ok) {
      if (state.pos >= end) {
        break;
      }
      continue;
    }
    state.pending += state.src[state.pos++];
  }
  if (state.pending) {
    pushPending(state);
  }
}

function balancePairs(delimiters: Delimiter[]): void {
  const openersBottom: Record<number, number[]> = {};
  if (!delimiters.length) {
    return;
  }
  let headerIdx = 0;
  let lastTokenIdx = -2;
  const jumps: number[] = [];
  for (let closerIdx = 0; closerIdx < delimiters.length; closerIdx++) {
    const closer = delimiters[closerIdx];
    jumps.push(0);
    if (delimiters[headerIdx].marker !== closer.marker || lastTokenIdx !== closer.token - 1) {
      headerIdx = closerIdx;
    }
    lastTokenIdx = closer.token;
    closer.length = closer.length || 0;
    if (!closer.close) {
      continue;
    }
    openersBottom[closer.marker] ??= [-1, -1, -1, -1, -1, -1];
    const minOpenerIdx = openersBottom[closer.marker][(closer.open ? 3 : 0) + (closer.length % 3)];
    let openerIdx = headerIdx - jumps[headerIdx] - 1;
    let newMinOpenerIdx = openerIdx;
    for (; openerIdx > minOpenerIdx; openerIdx -= jumps[openerIdx] + 1) {
      const opener = delimiters[openerIdx];
      if (opener.marker !== closer.marker || !opener.open || opener.end >= 0) {
        continue;
      }
      const odd =
        (opener.close || closer.open) &&
        (opener.length + closer.length) % 3 === 0 &&
        (opener.length % 3 !== 0 || closer.length % 3 !== 0);
      if (!odd) {
        const lastJump = openerIdx > 0 && !delimiters[openerIdx - 1].open ? jumps[openerIdx - 1] + 1 : 0;
        jumps[closerIdx] = closerIdx - openerIdx + lastJump;
        jumps[openerIdx] = lastJump;
        closer.open = false;
        opener.end = closerIdx;
        opener.close = false;
        newMinOpenerIdx = -1;
        lastTokenIdx = -2;
        break;
      }
    }
    if (newMinOpenerIdx !== -1) {
      openersBottom[closer.marker][(closer.open ? 3 : 0) + ((closer.length || 0) % 3)] = newMinOpenerIdx;
    }
  }
}

function retype(found: InlineToken, type: string, tag: string, nesting: number): void {
  found.type = `${tag}_${type}`;
  found.nesting = nesting;
  found.markup = type;
  found.content = "";
}

function strikethroughPairs(tokens: InlineToken[], delimiters: Delimiter[]): void {
  const lone: number[] = [];
  for (const start of delimiters) {
    if (start.marker !== 0x7e || start.end === -1) {
      continue;
    }
    const end = delimiters[start.end];
    retype(tokens[start.token], "open", "s", 1);
    retype(tokens[end.token], "close", "s", -1);
    tokens[start.token].markup = tokens[end.token].markup = "~~";
    const before = tokens[end.token - 1];
    if (before.type === "text" && before.content === "~") {
      lone.push(end.token - 1);
    }
  }
  while (lone.length) {
    const i = lone.pop()!;
    let j = i + 1;
    while (j < tokens.length && tokens[j].type === "s_close") {
      j += 1;
    }
    j -= 1;
    if (i !== j) {
      [tokens[i], tokens[j]] = [tokens[j], tokens[i]];
    }
  }
}

function emphasisPairs(tokens: InlineToken[], delimiters: Delimiter[]): void {
  for (let i = delimiters.length - 1; i >= 0; i--) {
    const start = delimiters[i];
    if ((start.marker !== 0x5f && start.marker !== 0x2a) || start.end === -1) {
      continue;
    }
    const end = delimiters[start.end];
    const strong =
      i > 0 &&
      delimiters[i - 1].end === start.end + 1 &&
      delimiters[i - 1].marker === start.marker &&
      delimiters[i - 1].token === start.token - 1 &&
      delimiters[start.end + 1].token === end.token + 1;
    const char = String.fromCharCode(start.marker);
    const tag = strong ? "strong" : "em";
    retype(tokens[start.token], "open", tag, 1);
    retype(tokens[end.token], "close", tag, -1);
    tokens[start.token].markup = tokens[end.token].markup = strong ? char + char : char;
    if (strong) {
      tokens[delimiters[i - 1].token].content = "";
      tokens[delimiters[start.end + 1].token].content = "";
      i -= 1;
    }
  }
}

function fragmentsJoin(tokens: InlineToken[]): InlineToken[] {
  const out: InlineToken[] = [];
  let level = 0;
  for (const current of tokens) {
    if (current.nesting < 0) {
      level -= 1;
    }
    current.level = level;
    if (current.nesting > 0) {
      level += 1;
    }
    const last = out[out.length - 1];
    if (current.type === "text" && last?.type === "text") {
      current.content = last.content + current.content;
      out[out.length - 1] = current;
    } else {
      out.push(current);
    }
  }
  return out;
}

function beside(tokens: InlineToken[], from: number, step: number): number {
  let i = from + step;
  while (tokens[i]?.type === "text" && !tokens[i].content) {
    i += step;
  }
  return i;
}

function boldItalic(tokens: InlineToken[]): void {
  for (const [i, open] of tokens.entries()) {
    if (open.type !== "em_open") {
      continue;
    }
    const opens = beside(tokens, i, 1);
    if (tokens[opens]?.type !== "strong_open" || tokens[opens].markup[0] !== open.markup[0]) {
      continue;
    }
    const closes = tokens.findIndex((other, j) => j > i && other.type === "em_close" && other.level === open.level);
    if (closes < 0 || tokens[beside(tokens, closes, -1)]?.type !== "strong_close") {
      continue;
    }
    for (const [outer, inner] of [
      [open, tokens[opens]],
      [tokens[closes], tokens[beside(tokens, closes, -1)]],
    ]) {
      [outer.type, inner.type] = [inner.type, outer.type];
      [outer.markup, inner.markup] = [inner.markup, outer.markup];
    }
  }
}

export function inlineTokens(src: string): InlineToken[] {
  const state: State = {
    src,
    pos: 0,
    posMax: src.length,
    level: 0,
    pending: "",
    pendingLevel: 0,
    tokens: [],
    meta: [],
    delimiters: [],
    previous: [],
    cache: new Map(),
    backticks: {},
    backticksScanned: false,
    linkLevel: 0,
  };
  tokenize(state);
  const scopes = [state.delimiters, ...state.meta.filter((meta): meta is Delimiter[] => meta !== null)];
  scopes.forEach(balancePairs);
  scopes.forEach((scope) => strikethroughPairs(state.tokens, scope));
  scopes.forEach((scope) => emphasisPairs(state.tokens, scope));
  const tokens = fragmentsJoin(state.tokens);
  boldItalic(tokens);
  return tokens;
}
