import { bytesToBase64 } from "../../shared/base64.ts";

/**
 * The publish token, locked with a passphrase.
 *
 * Reading the blog and writing to it are different privileges, so they are
 * different tokens here. The read one sits in this browser as it is: the site
 * it can see is published anyway. The write one is the one worth locking, and
 * it is opened at the moment of publishing — the passphrase is typed then,
 * held for as long as the tab is open, and never stored anywhere.
 *
 * Losing the passphrase loses the token, not the blog: issue another one on
 * GitHub and lock it again.
 */

/** Slow enough to be worth a passphrase, fast enough to type behind. */
const ITERATIONS = 210_000;

export interface LockedToken {
  salt: string;
  iv: string;
  cipher: string;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function keyFrom(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function lockToken(token: string, passphrase: string): Promise<LockedToken> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(passphrase, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(token),
  );
  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(cipher)),
  };
}

/** Throws when the passphrase is wrong: AES-GCM will not open on a bad key. */
export async function unlockToken(locked: LockedToken, passphrase: string): Promise<string> {
  const key = await keyFrom(passphrase, base64ToBytes(locked.salt));
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(locked.iv) as BufferSource },
      key,
      base64ToBytes(locked.cipher) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("That passphrase does not open the publish token.");
  }
}
