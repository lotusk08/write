/** What a shared draft's people are called and coloured, and its link: the parts the app needs before, or without, the room itself. */

export const CARET_COLORS = ["#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];

const NAME_KEY = "write:share-name";
const SHADES = [
  "amber", "briar", "cedar", "clover", "coral", "dusk", "fern", "flint",
  "juniper", "linden", "maple", "moss", "onyx", "plum", "sage", "slate",
];
const BIRDS = [
  "crane", "finch", "heron", "ibis", "kite", "lark", "myna", "oriole",
  "petrel", "plover", "robin", "sparrow", "swallow", "tern", "thrush", "wren",
];

export const SHARE_TOKEN = /^[0-9a-f]{32}$/;

function randomName(): string {
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  return `${pick(SHADES)} ${pick(BIRDS)}`;
}

export function participantName(): string {
  try {
    const stored = localStorage.getItem(NAME_KEY);
    if (stored) {
      return stored;
    }
    const name = randomName();
    localStorage.setItem(NAME_KEY, name);
    return name;
  } catch {
    return randomName();
  }
}

export function saveParticipantName(raw: string): void {
  const name = raw.trim();
  if (!name) {
    return;
  }
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
  }
}

export function participantColor(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return CARET_COLORS[hash % CARET_COLORS.length];
}

export interface SharePeer {
  key: number;
  name: string;
  color: string;
  you: boolean;
}

export function samePeers(a: SharePeer[], b: SharePeer[]): boolean {
  return (
    a.length === b.length &&
    a.every((peer, index) => {
      const other = b[index];
      return (
        peer.key === other.key &&
        peer.name === other.name &&
        peer.color === other.color &&
        peer.you === other.you
      );
    })
  );
}

export function shareLink(token: string): string {
  return `${window.location.origin}/?share=${token}`;
}
