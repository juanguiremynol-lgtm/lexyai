import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { purgeRepartoPdfs, REPARTO_BUCKET } from "./judicialRepartoPurge.ts";

Deno.test("acknowledges only objects whose absence the privileged Storage API verifies", async () => {
  const verified: string[][] = [];
  const bucket = {
    remove: (paths: string[]) => {
      assertEquals(paths, ["removed", "still-present", "denied"]);
      return Promise.resolve({ error: null });
    },
    info: (path: string) => Promise.resolve({ error: path === "removed" ? { status: 404 } : path === "denied" ? { status: 403 } : null }),
  };
  const client = {
    storage: { from: (name: string) => { assertEquals(name, REPARTO_BUCKET); return bucket; } },
    from: (table: string) => {
      assertEquals(table, "judicial_reparto_pdf_purges");
      return { delete: () => ({ in: (_field: string, paths: string[]) => {
        verified.push(paths);
        return Promise.resolve({ error: null });
      } }) };
    },
  } as unknown as SupabaseClient;
  assertEquals(await purgeRepartoPdfs(client, ["removed", "still-present", "denied"]), { verifiedAbsent: 1, pending: 2 });
  assertEquals(verified, [["removed"]]);
});

Deno.test("keeps the pending receipt when Storage cannot remove a file", async () => {
  const client = {
    storage: { from: () => ({ remove: () => Promise.resolve({ error: { status: 503 } }) }) },
  } as unknown as SupabaseClient;
  assertEquals(await purgeRepartoPdfs(client, ["retry-later"]), { verifiedAbsent: 0, pending: 1 });
});
