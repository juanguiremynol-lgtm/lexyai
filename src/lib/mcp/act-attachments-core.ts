/**
 * Core of the `list_act_attachments` MCP tool, injectable for tests.
 * Authorization = the caller's RLS-scoped client only. The act is read first;
 * its matter is then resolved through the same RLS client (not deleted), and,
 * if the caller named a matter, it must be the act's matter.
 */
import {
  ownCopyCandidates,
  summarizeActAttachments,
  verifyPdfBytes,
  type FetchLike,
  type VerificationResult,
} from "../act-attachments-inventory";

type Resolver = (
  sb: any,
  args: { id?: string; radicado?: string },
) => Promise<{ item: Record<string, unknown> | null; error: string | null; note?: string | null }>;

export async function getActAttachments(args: {
  sb: any;
  resolveWorkItem: Resolver;
  fetchImpl: FetchLike;
  act_id: string;
  work_item_id?: string;
  radicado?: string;
  maxVerify?: number;
}): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const { sb } = args;
  const { data: act, error } = await sb
    .from("work_item_acts")
    .select("id, work_item_id, act_date, description, source, documentos, documentos_observados_en, raw_data")
    .eq("id", args.act_id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!act) return { ok: false, error: "Actuación no encontrada (o no pertenece a tu cuenta)." };

  const own = await args.resolveWorkItem(sb, { id: act.work_item_id });
  if (own.error || !own.item) return { ok: false, error: "Actuación no encontrada (o no pertenece a tu cuenta)." };

  let note: string | null = null;
  if (args.work_item_id || args.radicado) {
    const named = await args.resolveWorkItem(sb, { id: args.work_item_id, radicado: args.radicado });
    if (named.error || !named.item) return { ok: false, error: named.error ?? "Asunto no encontrado." };
    if (named.item.id !== act.work_item_id) return { ok: false, error: "La actuación no pertenece al asunto indicado." };
    note = named.note ?? null;
  }

  const verifications: Record<string, VerificationResult> = {};
  const urls = [...new Set(ownCopyCandidates(act).map((c) => c.own).filter((u): u is string => !!u))];
  for (const u of urls.slice(0, Math.max(0, Math.min(20, Math.trunc(args.maxVerify ?? 10))))) {
    verifications[u] = await verifyPdfBytes(u, args.fetchImpl);
  }
  const summary = summarizeActAttachments(act, verifications);
  return {
    ok: true,
    data: {
      resolucion: note,
      work_item_id: act.work_item_id,
      act_id: act.id,
      act_date: act.act_date ?? null,
      source: act.source ?? null,
      ...summary,
    },
  };
}
