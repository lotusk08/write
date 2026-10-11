import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("cloudflare:workers", () => ({ DurableObject: class { constructor(public ctx: unknown) {} } }));

const { Passkeys } = await import("./passkeys.ts");
const { ShareRoom } = await import("./share.ts");
const sqlite = "node:sqlite";
const { DatabaseSync } = (await import(/* @vite-ignore */ sqlite)) as {
  DatabaseSync: new (path: string) => {
    prepare(query: string): { all(...params: unknown[]): unknown[]; run(...params: unknown[]): unknown };
  };
};

function sqlStorage() {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query: string, ...params: (string | number)[]) {
      const statement = db.prepare(query);
      const rows = /^\s*select|returning/i.test(query) ? statement.all(...params) : (statement.run(...params), []);
      return { toArray: () => rows, one: () => rows[0] };
    },
  };
}

function storage() {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key: string | string[]) =>
      Array.isArray(key) ? new Map(key.filter((k) => data.has(k)).map((k) => [k, data.get(k)])) : data.get(key),
    put: async (entries: string | Record<string, unknown>, value?: unknown) => {
      for (const [key, item] of typeof entries === "string" ? [[entries, value] as const] : Object.entries(entries)) {
        data.set(key, item);
      }
    },
    delete: async (keys: string[]) => keys.forEach((key) => data.delete(key)),
    deleteAll: async () => data.clear(),
    getAlarm: async () => null,
    setAlarm: async () => undefined,
    deleteAlarm: async () => undefined,
  };
}

describe("password attempts", () => {
  it("blocks a connection after ten misses for fifteen minutes, and only that one", () => {
    const store = new Passkeys({ storage: { sql: sqlStorage() } } as never, {} as never);
    for (let miss = 0; miss < 10; miss++) {
      expect(store.attempt("a", false)).toBe("wrong");
    }
    expect(store.attempt("a", true)).toBe("blocked");
    expect(store.attempt("b", true)).toBe("ok");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 15 * 60 * 1000 + 1);
    expect(store.attempt("a", true)).toBe("ok");
    vi.useRealTimers();
  });
});

describe("share rooms", () => {
  const seed = Y.encodeStateAsUpdate(new Y.Doc());

  async function room(owner?: string) {
    const state = storage();
    const share = new ShareRoom({ storage: state } as never);
    await share.fetch(new Request("https://share/seed", { method: "POST", body: seed, headers: owner ? { "x-share-owner": owner } : {} }));
    return { share, state };
  }

  it("ends only for the key it was started with", async () => {
    const { share, state } = await room("key");
    expect((await share.fetch(new Request("https://share/", { method: "DELETE", headers: { "x-share-owner": "other" } }))).status).toBe(403);
    expect((await share.fetch(new Request("https://share/", { method: "DELETE" }))).status).toBe(403);
    expect(state.data.get("live")).toBe(true);
    expect((await share.fetch(new Request("https://share/", { method: "DELETE", headers: { "x-share-owner": "key" } }))).status).toBe(204);
    expect(state.data.size).toBe(0);
  });

  it("lets a share started before keys existed end as it did", async () => {
    const { share } = await room();
    expect((await share.fetch(new Request("https://share/", { method: "DELETE" }))).status).toBe(204);
  });

  it("closes a socket that sends more than a megabyte at once", async () => {
    const { share } = await room("key");
    const closed: number[] = [];
    const socket = { close: (code: number) => closed.push(code) };
    await (share as unknown as { receive: (s: unknown, e: unknown) => Promise<void> }).receive(socket, {
      data: new Uint8Array(1024 * 1024 + 1).buffer,
    });
    expect(closed).toEqual([1009]);
  });
});
