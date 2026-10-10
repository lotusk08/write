// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { markdownToDoc } from "./import.ts";
import { docToMarkdown } from "./markdown.ts";
import { onRemoteChange, pushDoc, seedUpdate, type ShareSession } from "./share.ts";

function peer(seed: Uint8Array): ShareSession {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, seed);
  const text = doc.getText("html");
  return { token: "t", doc, provider: null as never, text, base: text.toString() };
}

function sync(a: ShareSession, b: ShareSession) {
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)));
  Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)));
}

describe("shared drafts", () => {
  it("merges two people editing different paragraphs", () => {
    const seed = seedUpdate(markdownToDoc("First paragraph\n\nSecond paragraph"));
    const a = peer(seed);
    const b = peer(seed);
    const seen: string[] = [];
    onRemoteChange(b, () => null, (doc) => seen.push(docToMarkdown(doc)));

    pushDoc(a, markdownToDoc("First paragraph, edited\n\nSecond paragraph"));
    pushDoc(b, markdownToDoc("First paragraph\n\nSecond paragraph, too"));
    sync(a, b);

    expect(a.text.toString()).toBe(b.text.toString());
    expect(seen.at(-1)).toBe("First paragraph, edited\n\nSecond paragraph, too");
  });

  it("does not echo a local edit back as a remote one", () => {
    const a = peer(seedUpdate(markdownToDoc("Hello")));
    let calls = 0;
    onRemoteChange(a, () => null, () => (calls += 1));
    pushDoc(a, markdownToDoc("Hello there"));
    expect(calls).toBe(0);
  });

  it("keeps an edit not yet sent when someone else's arrives first", () => {
    const seed = seedUpdate(markdownToDoc("Alpha\n\nBeta\n\nGamma"));
    const a = peer(seed);
    const b = peer(seed);
    let unsent: ReturnType<typeof markdownToDoc> | null = markdownToDoc("Alpha\n\nBeta\n\nGamma, from b");
    const shown: string[] = [];
    onRemoteChange(b, () => {
      const doc = unsent;
      unsent = null;
      return doc;
    }, (doc) => shown.push(docToMarkdown(doc)));

    pushDoc(a, markdownToDoc("Alpha, from a\n\nBeta\n\nGamma"));
    sync(a, b);
    sync(a, b);

    const expected = "Alpha, from a\n\nBeta\n\nGamma, from b";
    expect(shown.at(-1)).toBe(expected);
    expect(a.text.toString()).toBe(b.text.toString());
  });
});
