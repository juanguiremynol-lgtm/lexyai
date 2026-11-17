import { assertEquals } from "jsr:@std/assert@1";
import { authorizeAdminMailAction, type WorkItemAuthRow } from "./authorize.ts";

const OWNER = "11111111-1111-1111-1111-111111111111";
const PEER = "22222222-2222-2222-2222-222222222222";
const base: WorkItemAuthRow = { id: "w", owner_id: OWNER, workflow_type: "PETICION", lifecycle_state: "ACTIVE", deleted_at: null };
const box = { user_id: OWNER };

Deno.test("owner with own mailbox may link and search", () => {
  assertEquals(authorizeAdminMailAction(base, OWNER, "link", box).ok, true);
  assertEquals(authorizeAdminMailAction(base, OWNER, "search", box).ok, true);
});
Deno.test("same-org reader who can SELECT is denied 403", () => {
  for (const a of ["link", "search"] as const) {
    const d = authorizeAdminMailAction(base, PEER, a, { user_id: PEER });
    assertEquals(d.ok ? 0 : d.status, 403);
  }
});
Deno.test("archived, deleted, paused are denied 403", () => {
  for (const wi of [{ ...base, lifecycle_state: "ARCHIVED" }, { ...base, lifecycle_state: "DELETED" }, { ...base, deleted_at: "2026-11-01" }, { ...base, lifecycle_state: "PAUSED" }]) {
    const d = authorizeAdminMailAction(wi, OWNER, "link", box);
    assertEquals(d.ok ? 0 : d.status, 403);
  }
});
Deno.test("mailbox of another user or none is denied", () => {
  const d1 = authorizeAdminMailAction(base, OWNER, "link", null);
  const d2 = authorizeAdminMailAction(base, OWNER, "link", { user_id: PEER });
  assertEquals([d1.ok ? 0 : d1.status, d2.ok ? 0 : d2.status], [403, 403]);
});
Deno.test("missing matter 404, judicial workflow 400", () => {
  const d1 = authorizeAdminMailAction(null, OWNER, "link", box);
  const d2 = authorizeAdminMailAction({ ...base, workflow_type: "CGP" }, OWNER, "link", box);
  assertEquals([d1.ok ? 0 : d1.status, d2.ok ? 0 : d2.status], [404, 400]);
});
