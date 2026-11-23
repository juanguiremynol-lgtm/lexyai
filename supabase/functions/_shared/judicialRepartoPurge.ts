import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const REPARTO_BUCKET = "judicial-reparto";
const PURGES = "judicial_reparto_pdf_purges";
const BATCH_SIZE = 30;

export async function pendingRepartoPdfs(client: SupabaseClient, scope?: { workItemId: string } | { ownerId: string }) {
  let query = client.from(PURGES).select("pdf_path,owner_id,organization_id").order("queued_at").order("pdf_path");
  if (scope && "workItemId" in scope) query = query.eq("work_item_id", scope.workItemId);
  if (scope && "ownerId" in scope) query = query.eq("owner_id", scope.ownerId);
  const { data, error } = await query.limit(BATCH_SIZE);
  if (error) throw new Error("No se pudo consultar la purga de comprobantes judiciales.");
  return data ?? [];
}

export async function purgeRepartoPdfs(client: SupabaseClient, paths: string[]) {
  if (!paths.length) return { verifiedAbsent: 0, pending: 0 };
  const bucket = client.storage.from(REPARTO_BUCKET);
  const { error } = await bucket.remove(paths);
  if (error) return { verifiedAbsent: 0, pending: paths.length };

  const verifications = await Promise.allSettled(paths.map(async (path) => {
    const { error: infoError } = await bucket.info(path);
    // A successful DELETE response or a missing RLS row alone cannot certify
    // absence. The service-role Storage API itself must return not found.
    const notFound = infoError && (
      ("status" in infoError && String(infoError.status) === "404") ||
      ("statusCode" in infoError && ["404", "NoSuchKey"].includes(String(infoError.statusCode)))
    );
    return notFound ? path : null;
  }));
  const absent = verifications.flatMap((r) => r.status === "fulfilled" && r.value ? [r.value] : []);
  if (absent.length) {
    const { error: receiptError } = await client.from(PURGES).delete().in("pdf_path", absent);
    if (receiptError) return { verifiedAbsent: absent.length, pending: paths.length };
  }
  return { verifiedAbsent: absent.length, pending: paths.length - absent.length };
}
