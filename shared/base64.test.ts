import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./base64.ts";

function random(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 65536) {
    crypto.getRandomValues(bytes.subarray(i, i + 65536));
  }
  return bytes;
}

describe("bytesToBase64", () => {
  it("writes what Node's encoder writes, natively or through btoa", () => {
    const toBase64 = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "toBase64");
    const cases = [0, 1, 2, 3, 4, 0x7fff, 0x8000, 0x8001, 4 * 1024 * 1024 + 1].map(random);
    for (const native of [true, false]) {
      if (!native && toBase64) {
        delete (Uint8Array.prototype as { toBase64?: unknown }).toBase64;
      }
      try {
        for (const bytes of cases) {
          expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
        }
      } finally {
        if (toBase64) {
          Object.defineProperty(Uint8Array.prototype, "toBase64", toBase64);
        }
      }
    }
  });
});
