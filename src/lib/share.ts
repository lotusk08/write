import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { docToHtml, htmlToDoc } from "../editor/bridge.ts";
import type { JSONContent } from "../editor/doc.ts";
import { CARET_COLORS, participantColor, participantName, type SharePeer } from "./participants.ts";

/**
 * A shared draft is one Y.Text holding the body as canonical HTML — the
 * draft's JSON rendered by `docToHtml` with every address as written, so what
 * travels carries no device's blob URLs or site prefix. Local edits go in as
 * the smallest splice between the room's text as last seen and the new one,
 * so two people typing in different places merge; a remote change is read
 * back to a draft and handed to the editor, which keeps the caret where it
 * was.
 */

export interface ShareSession {
  token: string;
  doc: Y.Doc;
  provider: WebsocketProvider;
  text: Y.Text;
  /** The room's text as this tab last saw it, which local edits are measured against. */
  base: string;
}

const BODY = "html";
const LOCAL = Symbol("local edit");

const CLOSE_ENDED = 4404;



export function applyParticipantName(session: ShareSession, raw: string): void {
  const name = raw.trim() || participantName();
  session.provider.awareness.setLocalStateField("user", { name, color: participantColor(name) });
}

export function readPeers(session: ShareSession): SharePeer[] {
  const local = session.provider.awareness.clientID;
  const peers: SharePeer[] = [];
  for (const [id, state] of session.provider.awareness.getStates()) {
    const user = (state as { user?: { name?: unknown; color?: unknown } }).user;
    if (!user || typeof user.name !== "string") {
      continue;
    }
    peers.push({
      key: id,
      name: user.name,
      color: typeof user.color === "string" ? user.color : CARET_COLORS[0],
      you: id === local,
    });
  }
  return peers.sort((a, b) =>
    a.you !== b.you ? (a.you ? -1 : 1) : a.name.localeCompare(b.name) || a.key - b.key,
  );
}

export function sessionSnapshot(session: ShareSession): Uint8Array {
  return Y.encodeStateAsUpdate(session.doc);
}

function canonicalHtml(doc: JSONContent): string {
  return docToHtml(doc, { display: (src) => src });
}

export function seedUpdate(doc: JSONContent): Uint8Array {
  const ydoc = new Y.Doc();
  ydoc.getText(BODY).insert(0, canonicalHtml(doc));
  return Y.encodeStateAsUpdate(ydoc);
}

interface Splice {
  start: number;
  end: number;
  insert: string;
}

/** The smallest splice that turns `from` into `to`, in `from`'s positions. */
function splice(from: string, to: string): Splice | null {
  if (from === to) {
    return null;
  }
  let start = 0;
  const limit = Math.min(from.length, to.length);
  while (start < limit && from[start] === to[start]) {
    start += 1;
  }
  let tail = 0;
  while (tail < limit - start && from[from.length - 1 - tail] === to[to.length - 1 - tail]) {
    tail += 1;
  }
  return { start, end: from.length - tail, insert: to.slice(start, to.length - tail) };
}

/** Where a position in the text before a remote change sits after it. */
function mapThrough(delta: Y.YTextEvent["delta"], position: number): number {
  let before = 0;
  let after = 0;
  for (const op of delta) {
    if (typeof op.insert === "string") {
      after += op.insert.length;
    } else if (op.retain) {
      if (position < before + op.retain) {
        return after + position - before;
      }
      before += op.retain;
      after += op.retain;
    } else if (op.delete) {
      if (position < before + op.delete) {
        return after;
      }
      before += op.delete;
    }
  }
  return after + position - before;
}

function applySplice(session: ShareSession, change: Splice): void {
  session.doc.transact(() => {
    session.text.delete(change.start, change.end - change.start);
    session.text.insert(change.start, change.insert);
  }, LOCAL);
}

/**
 * Writes the draft into the room as the smallest splice from what this tab
 * last had of the room (`base`), so a change made since by someone else is
 * not undone by an older copy.
 */
export function pushDoc(session: ShareSession, doc: JSONContent): void {
  const change = splice(session.base, canonicalHtml(doc));
  if (change) {
    applySplice(session, change);
  }
  session.base = session.text.toString();
}

/**
 * Calls back with the room's draft whenever someone else changes it. A local
 * edit the editor has not sent yet (`unsent`) goes in first, moved through the
 * remote change, so neither side's keystrokes are lost to the other's.
 */
export function onRemoteChange(
  session: ShareSession,
  unsent: () => JSONContent | null,
  apply: (doc: JSONContent) => void,
): () => void {
  const observer = (event: Y.YTextEvent) => {
    if (event.transaction.origin === LOCAL) {
      return;
    }
    const local = unsent();
    const change = local ? splice(session.base, canonicalHtml(local)) : null;
    if (change) {
      const start = mapThrough(event.delta, change.start);
      const end = Math.max(start, mapThrough(event.delta, change.end));
      applySplice(session, { start, end, insert: change.insert });
    }
    session.base = session.text.toString();
    if (session.base) {
      apply(htmlToDoc(session.base));
    }
  };
  session.text.observe(observer);
  return () => session.text.unobserve(observer);
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
  const text = doc.getText(BODY);
  return { token, doc, provider, text, base: text.toString() };
}

export function leaveShare(session: ShareSession): void {
  session.provider.destroy();
  session.doc.destroy();
}
