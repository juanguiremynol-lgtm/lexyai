import { publicSnapshotIncomplete, publicSnapshotCompleted } from "./publicSnapshotFreshness.ts";
const now = Date.parse("2026-10-20T20:00:00Z");
function assert(value: unknown) { if (!value) throw new Error("assertion failed"); }
Deno.test("snapshot served today is stale when source observation was old", () => {
  assert(publicSnapshotIncomplete({busqueda:{fuente:"db",procesado:true,ultima_sync:"2026-10-18T12:00:00Z",timestamp:"2026-10-20T20:00:00Z"}},now));
  assert(!publicSnapshotIncomplete({busqueda:{fuente:"db",procesado:true,ultima_sync:"2026-10-20T12:00:00Z"}},now));
});
Deno.test("fresh partial scrape does not certify a completed read", () => {
  assert(publicSnapshotIncomplete({run_status:"LECTURA_PARCIAL",actuaciones:[{id:1}]},now));
  assert(publicSnapshotIncomplete({consulta_completa:false,actuaciones:[{id:1}]},now));
  assert(publicSnapshotIncomplete({busqueda:{fuente:"db",procesado:true}},now));
  assert(!publicSnapshotIncomplete({run_status:"SUCCESS_WITH_DATA",actuaciones:[{id:1}]},now));
});

Deno.test("a completed empty scrape does not stay pending indefinitely", () => {
  assert(publicSnapshotCompleted({run_status:"SUCCESS_EMPTY",busqueda:{fuente:"db",procesado:true,ultima_sync:"2026-10-20T12:00:00Z"}},now));
  assert(!publicSnapshotCompleted({run_status:"SUCCESS_EMPTY",busqueda:{fuente:"db",procesado:true,ultima_sync:"2026-10-18T12:00:00Z"}},now));
});

Deno.test("a yesterday snapshot is not today's daily source read", () => {
  assert(publicSnapshotIncomplete({run_status:"SUCCESS_WITH_DATA",busqueda:{fuente:"db",procesado:true,ultima_sync:"2026-10-20T04:30:00Z"}},Date.parse("2026-10-20T05:30:00Z")));
  assert(publicSnapshotIncomplete({run_status:"SUCCESS_WITH_DATA",persistencia_completa:false},now));
});
