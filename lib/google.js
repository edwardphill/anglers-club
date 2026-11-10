// Checks a "Sign in with Google" ID token: Google's signature (RS256, keys from its JWKS), the
// audience (this site's OAuth client ID), the issuer and expiry. Returns the token's claims.
import crypto from "node:crypto";
import { HttpError } from "./http.js";

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
let jwks = null, jwksUntil = 0;

async function keys() {
  if (globalThis.__nacJwks) return globalThis.__nacJwks;   // tests
  if (jwks && Date.now() < jwksUntil) return jwks;
  const res = await fetch(process.env.GOOGLE_JWKS_URL || JWKS_URL);
  if (!res.ok) throw new HttpError(503, "Couldn't reach Google to check the sign-in. Try again.");
  jwks = await res.json();
  const age = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "");
  jwksUntil = Date.now() + Math.min(6 * 3600, age ? Number(age[1]) : 3600) * 1000;
  return jwks;
}

const b64json = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

export async function verifyGoogleIdToken(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new HttpError(503, "Google sign-in isn't set up yet. Add GOOGLE_CLIENT_ID in Vercel and redeploy.");
  const bad = new HttpError(401, "That Google sign-in didn't check out. Try signing in again.");
  const parts = String(credential || "").split(".");
  if (parts.length !== 3) throw bad;
  let header, claims;
  try { header = b64json(parts[0]); claims = b64json(parts[1]); } catch { throw bad; }
  if (header.alg !== "RS256" || !header.kid) throw bad;

  let jwk = (await keys()).keys?.find((k) => k.kid === header.kid);
  if (!jwk && !globalThis.__nacJwks) { jwksUntil = 0; jwk = (await keys()).keys?.find((k) => k.kid === header.kid); }   // keys rotated
  if (!jwk) throw bad;
  const ok = crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  if (!ok) throw bad;

  const now = Math.floor(Date.now() / 1000);
  if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) throw bad;
  if (claims.aud !== clientId) throw bad;
  if (!(claims.exp > now - 60) || (claims.iat && claims.iat > now + 300)) throw new HttpError(401, "That sign-in expired. Try again.");
  if (!claims.sub) throw bad;
  if (claims.email && claims.email_verified === false) throw new HttpError(401, "Verify your Google email address first, then sign in.");
  return claims;
}
