// A stand-in for Google sign-in in tests: a throwaway RSA key, its JWKS, and a way to mint ID
// tokens the server will accept (lib/google.js reads globalThis.__nacJwks when it's set).
import crypto from "node:crypto";

export function fakeGoogle(clientId = "test-client.apps.googleusercontent.com") {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "test-" + crypto.randomBytes(4).toString("hex");
  const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] };
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const mint = (claims = {}, opts = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const head = enc({ alg: "RS256", kid: opts.kid || kid, typ: "JWT" });
    const body = enc({ iss: "https://accounts.google.com", aud: clientId, iat: now, exp: now + 3600, email_verified: true, ...claims });
    const sig = crypto.sign("RSA-SHA256", Buffer.from(head + "." + body), opts.key || privateKey).toString("base64url");
    return `${head}.${body}.${sig}`;
  };
  return { clientId, jwks, mint };
}
