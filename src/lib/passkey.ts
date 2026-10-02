import { passkeyChallenge, passkeyLogin, passkeyRegister } from "./api.ts";

const OWNER = new TextEncoder().encode("write-owner");

function bytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function text(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function cancelled(cause: unknown): boolean {
  return cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "AbortError");
}

export function passkeysAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

export async function addPasskey(password: string): Promise<string | null> {
  const options = await passkeyChallenge();
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        challenge: bytes(options.challenge),
        rp: { id: options.rpId, name: "write" },
        user: { id: OWNER, name: "write", displayName: "write" },
        pubKeyCredParams: options.algorithms.map((alg) => ({ type: "public-key", alg })),
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        excludeCredentials: options.credentials.map((id) => ({ type: "public-key", id: bytes(id) })),
        attestation: "none",
        timeout: 120_000,
      },
    })) as PublicKeyCredential | null;
  } catch (cause) {
    if (cancelled(cause)) {
      return null;
    }
    if (cause instanceof DOMException && cause.name === "InvalidStateError") {
      throw new Error("This device already has a passkey for write.");
    }
    throw cause;
  }
  if (!credential) {
    return null;
  }
  const response = credential.response as AuthenticatorAttestationResponse;
  const publicKey = response.getPublicKey();
  if (!publicKey) {
    throw new Error("This device made a passkey the app cannot read.");
  }
  return passkeyRegister(
    {
      id: credential.id,
      clientDataJSON: text(response.clientDataJSON),
      authenticatorData: text(response.getAuthenticatorData()),
      publicKey: text(publicKey),
      alg: response.getPublicKeyAlgorithm(),
    },
    password,
  );
}

export async function signInWithPasskey(): Promise<string | null> {
  const options = await passkeyChallenge();
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: {
        challenge: bytes(options.challenge),
        rpId: options.rpId,
        allowCredentials: options.credentials.map((id) => ({ type: "public-key", id: bytes(id) })),
        userVerification: "required",
        timeout: 120_000,
      },
    })) as PublicKeyCredential | null;
  } catch (cause) {
    if (cancelled(cause)) {
      return null;
    }
    throw cause;
  }
  if (!credential) {
    return null;
  }
  const response = credential.response as AuthenticatorAssertionResponse;
  return passkeyLogin({
    id: credential.id,
    clientDataJSON: text(response.clientDataJSON),
    authenticatorData: text(response.authenticatorData),
    signature: text(response.signature),
  });
}
