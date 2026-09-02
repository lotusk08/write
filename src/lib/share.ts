import { getSchema, type JSONContent } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { buildEditorExtensions } from "../editor/extensions.ts";

export interface ShareSession {
  token: string;
  doc: Y.Doc;
  provider: WebsocketProvider;
}

const CLOSE_ENDED = 4404;
const CARET_COLORS = ["#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];

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
  try {
    if (name) {
      localStorage.setItem(NAME_KEY, name);
    } else {
      localStorage.removeItem(NAME_KEY);
    }
  } catch {
  }
}

export function applyParticipantName(session: ShareSession, raw: string): void {
  const name = raw.trim() || participantName();
  session.provider.awareness.setLocalStateField("user", { name, color: caretColor(name) });
}

function caretColor(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return CARET_COLORS[hash % CARET_COLORS.length];
}

export function shareLink(token: string): string {
  return `${window.location.origin}/?share=${token}`;
}

export function seedUpdate(doc: JSONContent): Uint8Array {
  const ydoc = prosemirrorJSONToYDoc(getSchema(buildEditorExtensions()), doc, "default");
  return Y.encodeStateAsUpdate(ydoc);
}

export function joinShare(token: string, onEnded: () => void, seed?: Uint8Array): ShareSession {
  const doc = new Y.Doc();
  if (seed) {
    Y.applyUpdate(doc, seed);
  }
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const provider = new WebsocketProvider(
    `${scheme}://${window.location.host}/api/share`,
    token,
    doc,
  );
  provider.on("connection-close", (event: CloseEvent | null) => {
    if (event?.code === CLOSE_ENDED) {
      onEnded();
    }
  });
  return { token, doc, provider };
}

export function leaveShare(session: ShareSession): void {
  session.provider.destroy();
  session.doc.destroy();
}

export function collabExtensions(session: ShareSession) {
  const name = participantName();
  return [
    ...buildEditorExtensions({ collab: true }),
    Collaboration.configure({ document: session.doc }),
    CollaborationCaret.configure({
      provider: session.provider,
      user: { name, color: caretColor(name) },
    }),
  ];
}
