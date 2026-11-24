import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const QUEUE = "work_item_termination_files";
const PREFIX_BATCH = 10;

/** The two allowed namespaces are immutable, exclusive to a removed matter.
 * Leave a durable record if a request fails or the bucket still lists files. */
export async function purgeTerminatedWorkItemFiles(client: SupabaseClient) {
  const { data: rows, error } = await client.from(QUEUE)
    .select("bucket_id,object_prefix").order("attempted_at", { nullsFirst: true })
    .order("queued_at").order("object_prefix").limit(PREFIX_BATCH);
  if (error) throw new Error("No se pudo leer la cola de archivos de asuntos terminados");
  let verifiedAbsent = 0;
  for (const row of rows ?? []) {
    const prefix = row.object_prefix;
    const { error: attemptError } = await client.from(QUEUE).update({ attempted_at: new Date().toISOString() })
      .eq("bucket_id", row.bucket_id).eq("object_prefix", prefix);
    if (attemptError) continue;
    const bucket = client.storage.from(row.bucket_id);
    const list = await bucket.list(prefix, { limit: 100 });
    if (list.error || !list.data || list.data.some((file) => !file.id || !file.name || file.name.includes("/"))) continue;
    if (list.data.length) {
      const { error: removeError } = await bucket.remove(list.data.map((file) => `${prefix}/${file.name}`));
      if (removeError) continue;
      const verification = await bucket.list(prefix, { limit: 1 });
      if (verification.error || !verification.data || verification.data.length) continue;
    }
    const { error: receiptError } = await client.from(QUEUE).delete()
      .eq("bucket_id", row.bucket_id).eq("object_prefix", prefix);
    if (!receiptError) verifiedAbsent++;
  }
  const attempted = rows?.length ?? 0;
  return { attempted, verifiedAbsent, pending: attempted - verifiedAbsent };
}
