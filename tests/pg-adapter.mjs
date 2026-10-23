// Points lib/db.js at a local Postgres through psql, with the same contract as
// Neon's sql.query(text, params): rows back as plain objects.
import { spawnSync } from "node:child_process";

const lit = (v) =>
  v === null || v === undefined ? "NULL"
    : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "NULL")
    : typeof v === "boolean" ? String(v)
    : "'" + String(v).replace(/'/g, "''") + "'";

export function usePsql(conn) {
  globalThis.__nacQuery = async (text, params = []) => {
    let sql = text.replace(/\$(\d+)/g, (_, n) => lit(params[Number(n) - 1]));
    const returns = /^\s*select\b/i.test(sql) || /\breturning\b/i.test(sql);
    if (returns) sql = `with __r as (${sql}) select coalesce(json_agg(__r), '[]'::json) from __r`;
    const r = spawnSync("psql", [...conn, "-At", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr.trim() + "\n--- " + text);
    return returns ? JSON.parse(r.stdout.trim() || "[]") : [];
  };
}
