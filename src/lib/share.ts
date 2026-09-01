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

export const SHARE_TOKEN = /^[0-9a-f]{32}$/;

export function shareLink(token: string): string {
  return `${window.location.origin}/?share=${token}`;
}

export function seedUpdate(doc: JSONContent): Uint8Array {
  const ydoc = prosemirrorJSONToYDoc(getSchema(buildEditorExtensions()), doc, "default");
  return Y.encodeStateAsUpdate(ydoc);
}

export function joinShare(token: string, onEnded: () => void): ShareSession {
  const doc = new Y.Doc();
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

export function collabExtensions(session: ShareSession, author: string) {
  return [
    ...buildEditorExtensions({ collab: true }),
    Collaboration.configure({ document: session.doc }),
    CollaborationCaret.configure({
      provider: session.provider,
      user: {
        name: author.trim() || "writer",
        color: CARET_COLORS[session.doc.clientID % CARET_COLORS.length],
      },
    }),
  ];
}
