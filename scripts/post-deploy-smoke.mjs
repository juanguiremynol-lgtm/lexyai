/**
 * post-deploy-smoke — ITER48.
 *
 * A green typecheck and a passing suite do not prove an edge function BOOTS.
 * GCP lost a day to a fix whose SQL was valid but whose module never parsed:
 * the container died before it could listen, Cloud Run held traffic on the
 * previous revision, and a dead commit looked deployed. We have the same
 * hazard, so every deploy is followed by an actual invocation of every
 * function, and "deploys but never answers" is a FAILURE.
 *
 * Usage: bun scripts/post-deploy-smoke.mjs <fn> [<fn> ...]
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const BASE = `${env.VITE_SUPABASE_URL}/functions/v1`;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const fns = process.argv.slice(2);
if (fns.length === 0) {
  console.error("usage: bun scripts/post-deploy-smoke.mjs <function> [...]");
  process.exit(2);
}

/**
 * A boot failure is a 5xx with no JSON body, a network error, or a timeout.
 * 400/401/403 are WELL-FORMED answers: the module parsed, the server listened
 * and the handler ran — which is exactly what this smoke asserts.
 */
async function smoke(name) {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);
    const res = await fetch(`${BASE}/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({ smoke: true }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not json */ }
    const ms = Date.now() - started;
    const bootFailed =
      res.status >= 500 && (parsed === null || /BOOT_ERROR|WORKER_LIMIT|not found/i.test(text));
    return {
      name,
      status: res.status,
      ms,
      ok: !bootFailed,
      detail: bootFailed ? text.slice(0, 200) : (parsed ? "json" : "text"),
    };
  } catch (err) {
    return { name, status: null, ms: Date.now() - started, ok: false, detail: String(err).slice(0, 200) };
  }
}

const results = await Promise.all(fns.map(smoke));
for (const r of results) {
  console.log(`${r.ok ? "OK  " : "DEAD"}  ${r.name.padEnd(28)} status=${r.status} ${r.ms}ms ${r.detail}`);
}
const dead = results.filter((r) => !r.ok);
console.log(`\n${results.length - dead.length}/${results.length} answered`);
process.exit(dead.length === 0 ? 0 : 1);
