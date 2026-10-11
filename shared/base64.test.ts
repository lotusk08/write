import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./base64.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function reference(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [b0, b1, b2] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    out += ALPHABET[b0 >> 2] + ALPHABET[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : ALPHABET[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : ALPHABET[b2 & 63];
  }
  return out;
}

function random(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 65536) {
    crypto.getRandomValues(bytes.subarray(i, i + 65536));
  }
  return bytes;
}

describe("bytesToBase64", () => {
  it("writes what the hand-rolled encoder wrote, natively or through btoa", () => {
    const toBase64 = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "toBase64");
    for (const native of [true, false]) {
      if (!native && toBase64) {
        delete (Uint8Array.prototype as { toBase64?: unknown }).toBase64;
      }
      try {
        for (const length of [0, 1, 2, 3, 4, 0x7fff, 0x8000, 0x8001, 4 * 1024 * 1024 + 1]) {
          const bytes = random(length);
          expect(bytesToBase64(bytes)).toBe(reference(bytes));
        }
        expect(bytesToBase64(new Uint8Array(70000))).toBe(reference(new Uint8Array(70000)));
      } finally {
        if (toBase64) {
          Object.defineProperty(Uint8Array.prototype, "toBase64", toBase64);
        }
      }
    }
  });
});
