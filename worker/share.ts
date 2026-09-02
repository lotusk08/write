import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;
const SAVE_DELAY_MS = 900;
const CLOSE_ENDED = 4404;
const ROOM_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export class ShareRoom {
  private state: DurableObjectState;
  private doc!: Y.Doc;
  private awareness!: awarenessProtocol.Awareness;
  private sockets = new Map<WebSocket, Set<number>>();
  private loaded = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.bind();
  }

  private bind(): void {
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      const message = encoding.createEncoder();
      encoding.writeVarUint(message, MESSAGE_SYNC);
      syncProtocol.writeUpdate(message, update);
      this.broadcast(encoding.toUint8Array(message), origin);
      this.queueSave();
    });
    this.awareness.on(
      "update",
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        if (origin instanceof WebSocket) {
          const owned = this.sockets.get(origin);
          if (owned) {
            for (const id of added) {
              owned.add(id);
            }
            for (const id of updated) {
              owned.add(id);
            }
            for (const id of removed) {
              owned.delete(id);
            }
          }
        }
        const changed = added.concat(updated, removed);
        const message = encoding.createEncoder();
        encoding.writeVarUint(message, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          message,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
        );
        this.broadcast(encoding.toUint8Array(message), null);
      },
    );
  }

  private async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    const stored = await this.state.storage.get("doc");
    if (stored instanceof Uint8Array) {
      Y.applyUpdate(this.doc, stored);
    } else if (stored instanceof ArrayBuffer) {
      Y.applyUpdate(this.doc, new Uint8Array(stored));
    }
  }

  private queueSave(): void {
    if (this.saveTimer !== null) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.state.storage.put({ doc: Y.encodeStateAsUpdate(this.doc), touched: Date.now() });
    }, SAVE_DELAY_MS);
  }

  private async keepAlive(): Promise<void> {
    await this.state.storage.put("touched", Date.now());
    if ((await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    }
  }

  async alarm(): Promise<void> {
    const touched = ((await this.state.storage.get("touched")) as number | undefined) ?? 0;
    const now = Date.now();
    if (this.sockets.size > 0) {
      await this.state.storage.setAlarm(now + ROOM_TTL_MS);
      return;
    }
    if (now < touched + ROOM_TTL_MS) {
      await this.state.storage.setAlarm(touched + ROOM_TTL_MS);
      return;
    }
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.state.storage.deleteAll();
    await this.state.storage.deleteAlarm();
    this.doc.destroy();
    this.loaded = false;
    this.bind();
  }

  private accept(socket: WebSocket): void {
    socket.accept();
    this.sockets.set(socket, new Set());
    const hello = encoding.createEncoder();
    encoding.writeVarUint(hello, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(hello, this.doc);
    socket.send(encoding.toUint8Array(hello));
    const states = this.awareness.getStates();
    if (states.size > 0) {
      const message = encoding.createEncoder();
      encoding.writeVarUint(message, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        message,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]),
      );
      socket.send(encoding.toUint8Array(message));
    }
    socket.addEventListener("message", (event) => void this.receive(socket, event));
    const drop = () => this.drop(socket);
    socket.addEventListener("close", drop);
    socket.addEventListener("error", drop);
  }

  private async receive(socket: WebSocket, event: MessageEvent): Promise<void> {
    const raw: unknown = event.data;
    let bytes: Uint8Array | null = null;
    if (raw instanceof ArrayBuffer) {
      bytes = new Uint8Array(raw);
    } else if (ArrayBuffer.isView(raw)) {
      bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    } else if (raw instanceof Blob) {
      bytes = new Uint8Array(await raw.arrayBuffer());
    }
    if (!bytes) {
      return;
    }
    try {
      const decoder = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, reply, this.doc, socket);
        if (encoding.length(reply) > 1) {
          socket.send(encoding.toUint8Array(reply));
        }
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          socket,
        );
      } else if (type === MESSAGE_QUERY_AWARENESS) {
        const message = encoding.createEncoder();
        encoding.writeVarUint(message, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          message,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
            ...this.awareness.getStates().keys(),
          ]),
        );
        socket.send(encoding.toUint8Array(message));
      }
    } catch {
      socket.close(1003, "Bad message.");
    }
  }

  private drop(socket: WebSocket): void {
    const owned = this.sockets.get(socket);
    if (!owned) {
      return;
    }
    this.sockets.delete(socket);
    if (owned.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [...owned], null);
    }
  }

  private broadcast(message: Uint8Array, skip: unknown): void {
    for (const socket of this.sockets.keys()) {
      if (socket === skip) {
        continue;
      }
      try {
        socket.send(message);
      } catch {
        this.drop(socket);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      if (!(await this.state.storage.get("live"))) {
        return new Response("No such share.", { status: 404 });
      }
      await this.load();
      await this.keepAlive();
      const pair = new WebSocketPair();
      this.accept(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (request.method === "POST" && url.pathname.endsWith("/seed")) {
      await this.load();
      const body = new Uint8Array(await request.arrayBuffer());
      if (body.byteLength > 0) {
        Y.applyUpdate(this.doc, body);
      }
      await this.state.storage.put({ doc: Y.encodeStateAsUpdate(this.doc), live: true });
      await this.keepAlive();
      return new Response(null, { status: 204 });
    }

    if (request.method === "DELETE") {
      for (const socket of this.sockets.keys()) {
        try {
          socket.close(CLOSE_ENDED, "Sharing ended.");
        } catch {
          this.sockets.delete(socket);
        }
      }
      this.sockets.clear();
      if (this.saveTimer !== null) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      await this.state.storage.deleteAll();
      await this.state.storage.deleteAlarm();
      this.doc.destroy();
      this.loaded = false;
      this.bind();
      return new Response(null, { status: 204 });
    }

    if (request.method === "GET") {
      return new Response(
        JSON.stringify({ live: Boolean(await this.state.storage.get("live")) }),
        { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } },
      );
    }

    return new Response("Not found.", { status: 404 });
  }
}
