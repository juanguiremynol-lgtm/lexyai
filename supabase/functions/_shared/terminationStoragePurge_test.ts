import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { purgeTerminatedWorkItemFiles } from "./terminationStoragePurge.ts";

Deno.test("termination cleanup deletes only verified files under the queued prefix", async () => {
  const queue = [
    { bucket_id: "lexdocket", object_prefix: "owner/matter" },
    { bucket_id: "estado-attachments", object_prefix: "publication/denied" },
    { bucket_id: "estado-attachments", object_prefix: "publication/unconfirmed" },
  ];
  const attempts: string[][] = [];
  const receipts: string[][] = [];
  const removed: string[][] = [];
  const listingCalls = new Map<string, number>();
  const sort = { order: () => sort, limit: () => Promise.resolve({ data: queue, error: null }) };
  const record = (rows: string[][]) => ({
    eq: (_key: string, bucket: string) => ({ eq: (_prefix: string, path: string) => {
      rows.push([bucket, path]);
      return Promise.resolve({ error: null });
    } }),
  });
  const client = {
    from: (table: string) => {
      assertEquals(table, "work_item_termination_files");
      return { select: () => sort, update: () => record(attempts), delete: () => record(receipts) };
    },
    storage: {
      from: (bucket: string) => ({
        list: (prefix: string) => {
          const times = (listingCalls.get(prefix) ?? 0) + 1;
          listingCalls.set(prefix, times);
          if (prefix.endsWith("/denied")) return Promise.resolve({ error: { status: 403 } });
          const data = times === 1 || prefix.endsWith("/unconfirmed") ? [{ id: "1", name: "file.pdf" }] : [];
          return Promise.resolve({ data, error: null });
        },
        remove: (paths: string[]) => {
          removed.push([bucket, ...paths]);
          return Promise.resolve({ error: null });
        },
      }),
    },
  } as unknown as SupabaseClient;
  assertEquals(await purgeTerminatedWorkItemFiles(client), { attempted: 3, verifiedAbsent: 1, pending: 2 });
  assertEquals(attempts, queue.map((entry) => [entry.bucket_id, entry.object_prefix]));
  assertEquals(removed, [["lexdocket", "owner/matter/file.pdf"], ["estado-attachments", "publication/unconfirmed/file.pdf"]]);
  assertEquals(receipts, [["lexdocket", "owner/matter"]]);
});
