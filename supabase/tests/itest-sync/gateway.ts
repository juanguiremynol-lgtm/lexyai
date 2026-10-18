// Local test gateway: /rest/v1 -> local PostgREST, /samai -> synthetic SAMAI, fault injection.
let samai: unknown = { actuaciones: [] };
let faults = { rpcUpsert: 0, readBack: 0, readBackMissing: 0, rpcUpsertOnFp: "" as string };
const log: string[] = [];
Deno.serve({ port: 54321, hostname: "127.0.0.1" }, async (req) => {
  const u = new URL(req.url);
  if (u.pathname === "/__ctl") {
    if (req.method === "POST") {
      const b = await req.json();
      if (b.samai !== undefined) samai = b.samai;
      if (b.faults) faults = { ...faults, ...b.faults };
      if (b.resetLog) log.length = 0;
    }
    return Response.json({ faults, log });
  }
  if (u.pathname.startsWith("/samai/")) {
    await req.text();
    return Response.json(samai);
  }
  if (u.pathname.startsWith("/rest/v1/")) {
    const path = u.pathname.slice("/rest/v1".length);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
    if (path === "/rpc/rpc_upsert_work_item_acts" && faults.rpcUpsert > 0) {
      const txt = new TextDecoder().decode(body);
      if (!faults.rpcUpsertOnFp || txt.includes(faults.rpcUpsertOnFp)) {
        faults.rpcUpsert--; log.push("FAULT rpc_upsert");
        return Response.json({ code: "XX000", message: "injected upsert failure" }, { status: 500 });
      }
    }
    if (path === "/work_item_acts" && req.method === "GET" && u.searchParams.has("hash_fingerprint") && faults.readBack > 0) {
      faults.readBack--; log.push("FAULT readback");
      return Response.json({ code: "XX000", message: "injected read-back failure" }, { status: 500 });
    }
    if (path === "/work_item_acts" && req.method === "GET" && u.searchParams.has("hash_fingerprint") && faults.readBackMissing > 0) {
      faults.readBackMissing--; log.push("FAULT readback missing");
      return Response.json([]);
    }
    const h = new Headers(req.headers); h.delete("host");
    const r = await fetch(`http://127.0.0.1:3001${path}${u.search}`, { method: req.method, headers: h, body });
    if (path.startsWith("/rpc/") || path === "/work_item_acts") log.push(`${req.method} ${path} ${r.status}`);
    return new Response(r.body, { status: r.status, headers: r.headers });
  }
  return new Response("not found", { status: 404 });
});
