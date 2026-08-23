/**
 * Who is asking, according to Cloudflare Access.
 *
 * The token that can write to the blog lives on this Worker now, so the only
 * thing standing between the internet and the blog is this file. Access sits in
 * front of the hostname, signs in whoever its policy allows, and puts a signed
 * assertion of who they are on every request it lets through.
 *
 * That header is only worth as much as the check on it: anyone can send one.
 * So it is verified here — signature against Cloudflare's published keys, then
 * audience, issuer and expiry — rather than trusted for being present. And the
 * Worker fails closed: without both `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` set
 * there is no way to verify anything, so nothing is let through at all.
 */

export interface AccessConfig {
  /** `example.cloudflareaccess.com`, or just `example`. */
  teamDomain: string;
  /** The Application Audience tag, from the Access application's overview. */
  aud: string;
  /** When set, the only address allowed through, whatever the policy says. */
  email?: string;
}

export interface AccessIdentity {
  email: string;
  subject: string;
}

/** Cloudflare rotates these, so they are re-fetched rather than pinned. */
const JWKS_TTL_MS = 60 * 60 * 1000;

let cache: { issuer: string; keys: Map<string, CryptoKey>; at: number } | null = null;

/** Accepts a bare team name, a hostname, or a full URL — all mean one issuer. */
export function issuerFor(teamDomain: string): string {
  const host = teamDomain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return `https://${host.includes(".") ? host : `${host}.cloudflareaccess.com`}`;
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeSegment(segment: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

async function verifyingKeys(issuer: string, now: number): Promise<Map<string, CryptoKey>> {
  if (cache && cache.issuer === issuer && now - cache.at < JWKS_TTL_MS) {
    return cache.keys;
  }

  const response = await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!response.ok) {
    throw new Error(`Could not read Access signing keys from ${issuer} (${response.status}).`);
  }
  const { keys: jwks } = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  if (!jwks?.length) {
    throw new Error(`${issuer} published no Access signing keys.`);
  }

  const keys = new Map<string, CryptoKey>();
  for (const jwk of jwks) {
    if (!jwk.kid) {
      continue;
    }
    keys.set(
      jwk.kid,
      await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      ),
    );
  }

  cache = { issuer, keys, at: now };
  return keys;
}

interface AccessClaims {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  email?: string;
  sub?: string;
}

/**
 * Throws unless the request carries an assertion Cloudflare signed, for this
 * application, that has not expired. The thrown message is shown to whoever is
 * signed in, so it says which of those failed.
 */
export async function verifyAccess(
  request: Request,
  config: AccessConfig,
): Promise<AccessIdentity> {
  const token =
    request.headers.get("cf-access-jwt-assertion") ??
    /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1] ??
    "";
  if (!token) {
    throw new Error(
      "No Cloudflare Access assertion on this request. It reached the Worker without going through Access — check the Access application covers this hostname.",
    );
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed Access assertion.");
  }

  const issuer = issuerFor(config.teamDomain);
  const now = Date.now();
  const header = decodeSegment(parts[0]) as { kid?: string; alg?: string };
  if (header.alg !== "RS256") {
    throw new Error(`Unexpected Access signing algorithm: ${header.alg}.`);
  }

  const keys = await verifyingKeys(issuer, now);
  const key = header.kid ? keys.get(header.kid) : undefined;
  if (!key) {
    throw new Error("Access signed this with a key that issuer does not publish.");
  }

  const signed = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(parts[2]) as BufferSource,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`) as BufferSource,
  );
  if (!signed) {
    throw new Error("That Access assertion is not signed by Cloudflare.");
  }

  const claims = decodeSegment(parts[1]) as AccessClaims;
  const audience = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!audience.includes(config.aud)) {
    throw new Error(
      "That Access assertion was issued for a different application. ACCESS_AUD must be this application's Audience tag.",
    );
  }
  if (claims.iss !== issuer) {
    throw new Error(`That Access assertion came from ${claims.iss}, not ${issuer}.`);
  }
  const seconds = now / 1000;
  if (typeof claims.exp !== "number" || claims.exp <= seconds) {
    throw new Error("That Access session has expired. Reload to sign in again.");
  }
  if (typeof claims.nbf === "number" && claims.nbf > seconds + 60) {
    throw new Error("That Access assertion is not valid yet.");
  }

  const email = (claims.email ?? "").toLowerCase();
  if (config.email && email !== config.email.trim().toLowerCase()) {
    throw new Error(`${claims.email} is signed in, but this deployment only publishes as ${config.email}.`);
  }

  return { email: claims.email ?? "", subject: claims.sub ?? "" };
}
