import { DurableObject } from "cloudflare:workers";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGES = 50;
const MAX_CREDENTIALS = 20;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const ALGORITHMS = [-7, -257] as const;

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED = 0x40;

export interface StoredCredential {
  key: ArrayBuffer;
  alg: number;
  counter: number;
}

export class Passkeys extends DurableObject {
  private ready = false;

  private get sql(): SqlStorage {
    const sql = this.ctx.storage.sql;
    if (!this.ready) {
      sql.exec(
        "CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, key BLOB NOT NULL, alg INTEGER NOT NULL, counter INTEGER NOT NULL, created INTEGER NOT NULL)",
      );
      sql.exec("CREATE TABLE IF NOT EXISTS challenges (value TEXT PRIMARY KEY, expires INTEGER NOT NULL)");
      this.ready = true;
    }
    return sql;
  }

  challenge(): { challenge: string; credentials: string[] } {
    const sql = this.sql;
    const now = Date.now();
    sql.exec("DELETE FROM challenges WHERE expires <= ?", now);
    sql.exec(
      "DELETE FROM challenges WHERE value IN (SELECT value FROM challenges ORDER BY expires DESC LIMIT -1 OFFSET ?)",
      MAX_CHALLENGES - 1,
    );
    const challenge = base64url(crypto.getRandomValues(new Uint8Array(32)));
    sql.exec("INSERT INTO challenges (value, expires) VALUES (?, ?)", challenge, now + CHALLENGE_TTL_MS);
    const credentials = sql.exec<{ id: string }>("SELECT id FROM credentials").toArray().map((row) => row.id);
    return { challenge, credentials };
  }

  consume(challenge: string): boolean {
    const cursor = this.sql.exec(
      "DELETE FROM challenges WHERE value = ? AND expires > ? RETURNING value",
      challenge,
      Date.now(),
    );
    return cursor.toArray().length > 0;
  }

  credential(id: string): StoredCredential | null {
    const row = this.sql
      .exec<{ key: ArrayBuffer; alg: number; counter: number }>("SELECT key, alg, counter FROM credentials WHERE id = ?", id)
      .toArray()[0];
    return row ? { key: row.key, alg: row.alg, counter: row.counter } : null;
  }

  add(id: string, key: ArrayBuffer, alg: number): boolean {
    const sql = this.sql;
    const count = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM credentials").one().n;
    if (count >= MAX_CREDENTIALS) {
      return false;
    }
    sql.exec(
      "INSERT OR REPLACE INTO credentials (id, key, alg, counter, created) VALUES (?, ?, ?, 0, ?)",
      id,
      key,
      alg,
      Date.now(),
    );
    return true;
  }

  touch(id: string, counter: number): void {
    this.sql.exec("UPDATE credentials SET counter = ? WHERE id = ?", counter, id);
  }
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(value: unknown, max = 4096): Uint8Array | null {
  if (typeof value !== "string" || value.length > max || !/^[A-Za-z0-9_-]*$/.test(value)) {
    return null;
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let differences = 0;
  for (let index = 0; index < a.length; index++) {
    differences |= a[index] ^ b[index];
  }
  return differences === 0;
}

export interface Ceremony {
  type: "webauthn.create" | "webauthn.get";
  origin: string;
  rpId: string;
  consume: (challenge: string) => Promise<boolean>;
}

export interface CheckedData {
  authenticatorData: Uint8Array;
  clientDataHash: Uint8Array;
  counter: number;
  credentialId: Uint8Array | null;
}

export async function checkCeremony(
  clientDataJSON: Uint8Array,
  authenticatorData: Uint8Array,
  ceremony: Ceremony,
): Promise<CheckedData | string> {
  let clientData: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));
  } catch {
    return "The passkey's response could not be read.";
  }
  if (clientData.type !== ceremony.type) {
    return "The passkey answered a different request.";
  }
  if (clientData.origin !== ceremony.origin || clientData.crossOrigin === true) {
    return "The passkey was used from another site.";
  }
  if (authenticatorData.length < 37) {
    return "The passkey's response is incomplete.";
  }
  if (!equal(authenticatorData.slice(0, 32), await sha256(new TextEncoder().encode(ceremony.rpId)))) {
    return "The passkey belongs to another site.";
  }
  const flags = authenticatorData[32];
  if (!(flags & FLAG_USER_PRESENT) || !(flags & FLAG_USER_VERIFIED)) {
    return "The passkey was not confirmed on the device.";
  }
  if (typeof clientData.challenge !== "string" || !(await ceremony.consume(clientData.challenge))) {
    return "That passkey request has expired. Try again.";
  }
  const counter = new DataView(authenticatorData.buffer, authenticatorData.byteOffset).getUint32(33);
  let credentialId: Uint8Array | null = null;
  if (flags & FLAG_ATTESTED && authenticatorData.length >= 55) {
    const length = new DataView(authenticatorData.buffer, authenticatorData.byteOffset).getUint16(53);
    credentialId = authenticatorData.slice(55, 55 + length);
  }
  return { authenticatorData, clientDataHash: await sha256(clientDataJSON), counter, credentialId };
}

export async function importKey(spki: ArrayBuffer | Uint8Array, alg: number): Promise<CryptoKey | null> {
  try {
    if (alg === -7) {
      return await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    }
    if (alg === -257) {
      return await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    }
  } catch {
    return null;
  }
  return null;
}

function derToRaw(der: Uint8Array, size: number): Uint8Array | null {
  if (der[0] !== 0x30) {
    return null;
  }
  let offset = der[1] & 0x80 ? 2 + (der[1] & 0x7f) : 2;
  const raw = new Uint8Array(size * 2);
  for (let part = 0; part < 2; part++) {
    if (der[offset] !== 0x02) {
      return null;
    }
    const length = der[offset + 1];
    offset += 2;
    let value = der.slice(offset, offset + length);
    offset += length;
    while (value.length > size && value[0] === 0) {
      value = value.slice(1);
    }
    if (value.length > size) {
      return null;
    }
    raw.set(value, part * size + (size - value.length));
  }
  return raw;
}

export async function verifySignature(
  credential: StoredCredential,
  checked: CheckedData,
  signature: Uint8Array,
): Promise<boolean> {
  const key = await importKey(credential.key, credential.alg);
  if (!key) {
    return false;
  }
  const signed = new Uint8Array(checked.authenticatorData.length + checked.clientDataHash.length);
  signed.set(checked.authenticatorData);
  signed.set(checked.clientDataHash, checked.authenticatorData.length);
  try {
    if (credential.alg === -7) {
      const raw = derToRaw(signature, 32);
      return raw ? await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw, signed) : false;
    }
    return await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, signature, signed);
  } catch {
    return false;
  }
}

async function sessionKey(secret: string): Promise<CryptoKey> {
  const material = await sha256(new TextEncoder().encode(`write-session\u0000${secret}`));
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function issueSession(secret: string, now = Date.now()): Promise<string> {
  const body = `v1.${now + SESSION_TTL_MS}`;
  const mac = await crypto.subtle.sign("HMAC", await sessionKey(secret), new TextEncoder().encode(body));
  return `${body}.${base64url(new Uint8Array(mac))}`;
}

export async function validSession(token: string, secret: string, now = Date.now()): Promise<boolean> {
  const match = /^(v1\.(\d{13}))\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) {
    return false;
  }
  const expires = Number(match[2]);
  if (expires <= now || expires > now + SESSION_TTL_MS) {
    return false;
  }
  const mac = fromBase64url(match[3]);
  if (!mac) {
    return false;
  }
  return crypto.subtle.verify("HMAC", await sessionKey(secret), mac, new TextEncoder().encode(match[1]));
}
