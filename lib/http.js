// Small helpers shared by every API route.
import { createHash } from "node:crypto";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wraps a route: checks the method, turns thrown HttpErrors into JSON errors,
// and never caches responses.
export function route(methods, fn) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!methods.includes(req.method)) throw new HttpError(405, "That request method isn't supported here.");
      const out = await fn(req, res);
      res.status(200).json(out ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      res.status(status).json({
        error: status === 500 ? "Something went wrong on the server. Try again in a moment." : e.message,
      });
    }
  };
}

export function readBody(req) {
  let b;
  try {
    b = req.body;
  } catch {
    throw new HttpError(400, "The request body isn't valid JSON.");
  }
  if (typeof b === "string") {
    try {
      b = JSON.parse(b);
    } catch {
      throw new HttpError(400, "The request body isn't valid JSON.");
    }
  }
  return b && typeof b === "object" && !Array.isArray(b) ? b : {};
}

export function clientIp(req) {
  const fwd = String(req.headers?.["x-forwarded-for"] || "");
  return fwd.split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

export const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Where the site says it lives (canonical links, sitemap, JSON-LD, links in trip planner answers): SITE_URL, else the
// production domain Vercel provides, else the host the request came to.
export function siteBase(req) {
  const set = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : "");
  if (set) return set.replace(/\/+$/, "");
  const host = String((req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "angler-club.vercel.app").split(",")[0].trim().replace(/[^A-Za-z0-9.:-]/g, "");
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  return (local ? "http://" : "https://") + host;
}

// A stable key for an anonymous caller, for rate limits: a hash of the address (and browser), never the address itself.
export function clientKey(req) {
  const h = (req && req.headers) || {};
  const ip = String(h["x-forwarded-for"] || h["x-real-ip"] || (req && req.socket && req.socket.remoteAddress) || "").split(",")[0].trim();
  return createHash("sha256").update(ip + "|" + String(h["user-agent"] || "").slice(0, 80)).digest("hex").slice(0, 20);
}
