/**
 * email-semantics-backfill — Iteration 5, Part C.
 *
 * Re-reads the body (in memory, never persisted) of every CONFIRMED judicial
 * link whose regex subtype is opaque (NULL or OTRO_JUDICIAL), extracts the
 * identifiers the subject never carried, and asks the AI layer for a subtype.
 *
 * Resumable: a link is claimed by stamping `ai_classified_at`, so a run that
 * dies mid-batch never reprocesses what it already attempted. Honours the same
 * 50-call-per-run gateway cap as the sync.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, graphGet, ensureAccessToken } from "../_shared/outlookGraph.ts";
import { resolveCaller } from "../_shared/callerIdentity.ts";
import {
  bodyToText,
  extractBodyRadicadoCandidates,
  extractNij,
  isJudicialAddress,
} from "../_shared/emailMatcher.ts";
import {
  aiClassifyEmail,
  newAiGatewayState,
  AI_CONFIDENCE_CAP,
} from "../_shared/aiClassifyEmail.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const CONNECTION_COLUMNS =
  "id, user_id, organization_id, ms_account_email, scopes, access_token_cipher, access_token_nonce, refresh_token_cipher, refresh_token_nonce, token_expires_at";

const DEFAULT_BATCH = 25;
const MAX_BATCH = 50;

interface LinkRow {
  id: string;
  user_id: string;
  work_item_id: string;
  message_id: string;
  subject: string | null;
  sender: string | null;
  evidence_subtype: string | null;
  evidence_meta: Record<string, unknown> | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const cronKey = req.headers.get("x-cron-key");
    const isCron = Boolean(cronKey) && cronKey === Deno.env.get("CRON_SERVICE_KEY");

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch { /* sin cuerpo */ }
    const rawBatch = Number(body.batch_size);
    const batchSize = Number.isFinite(rawBatch) && rawBatch >= 1 && rawBatch <= MAX_BATCH
      ? Math.floor(rawBatch)
      : DEFAULT_BATCH;
    // Reproceso dirigido: ignora los filtros de estado/subtipo para un
    // conjunto explícito de vínculos (verificación y correcciones puntuales).
    const linkIds = Array.isArray(body.link_ids)
      ? (body.link_ids as unknown[]).map(String).slice(0, MAX_BATCH)
      : null;

    let userFilter: string | null = null;
    if (!isCron) {
      const caller = await resolveCaller(req);
      // pg_cron invoca con la service-role key: es una corrida global sin
      // filtro de usuario, igual que la cabecera x-cron-key.
      if (caller.kind === "service") {
        // corrida programada
      } else if (caller.kind === "user") {
        userFilter = caller.userId;
      } else {
        return json({ error: "No autenticado" }, 401);
      }
    }

    let query = admin
      .from("work_item_email_links")
      .select("id, user_id, work_item_id, message_id, subject, sender, evidence_subtype, evidence_meta")
      .order("received_at", { ascending: false })
      .limit(batchSize);
    if (linkIds) {
      query = query.in("id", linkIds);
    } else {
      query = query
        .eq("link_status", "CONFIRMED")
        .eq("direction", "received")
        .is("ai_classified_at", null)
        .or("evidence_subtype.is.null,evidence_subtype.eq.OTRO_JUDICIAL");
    }
    if (userFilter) query = query.eq("user_id", userFilter);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    // No-op barato: sin backlog la corrida programada termina de inmediato
    // (una sola consulta), así el cron puede quedarse fijo sin coste.
    if ((data ?? []).length === 0) {
      return json({ ok: true, ai_calls: 0, degraded: false, summary: { candidates: 0, remaining: 0, noop: true } });
    }
    const all = (data ?? []) as unknown as LinkRow[];
    const links = all.filter((l) => isJudicialAddress(l.sender));
    const nonJudicial = all.filter((l) => !isJudicialAddress(l.sender));
    // Sin contraparte judicial no hay clasificación posible: se marcan como
    // atendidos para que no bloqueen el avance del lote siguiente.
    if (nonJudicial.length > 0) {
      await admin
        .from("work_item_email_links")
        .update({ ai_classified_at: new Date().toISOString() })
        .in("id", nonJudicial.map((l) => l.id));
    }

    const aiState = newAiGatewayState();
    const tokenCache = new Map<string, string>();
    const summary = {
      candidates: links.length,
      non_judicial_skipped: nonJudicial.length,
      processed: 0,
      reclassified: 0,
      body_radicados_found: 0,
      effects_emitted: 0,
      errors: 0,
      remaining: 0,
      by_subtype: {} as Record<string, number>,
    };

    for (const link of links) {
      try {
        let accessToken = tokenCache.get(link.user_id) ?? null;
        if (!accessToken) {
          const { data: conn } = await admin
            .from("user_email_connections")
            .select(CONNECTION_COLUMNS)
            .eq("user_id", link.user_id)
            .eq("provider", "outlook")
            .eq("status", "CONNECTED")
            .maybeSingle();
          if (!conn) continue;
          accessToken = await ensureAccessToken(admin, conn as never);
          tokenCache.set(link.user_id, accessToken);
        }

        const full = await graphGet(
          `https://graph.microsoft.com/v1.0/me/messages/${link.message_id}?$select=body`,
          accessToken,
        );
        const bodyText = bodyToText(
          ((full as { body?: { content?: string } }).body?.content ?? "") as string,
        );

        const nij = extractNij(`${link.subject ?? ""}\n${bodyText}`);
        const candidates = extractBodyRadicadoCandidates(bodyText);
        if (candidates.length > 0) summary.body_radicados_found++;

        const ai = await aiClassifyEmail({ subject: link.subject, bodyText }, aiState, Deno.env.get("LOVABLE_API_KEY"));

        const meta: Record<string, unknown> = { ...(link.evidence_meta ?? {}) };
        if (nij) meta.nij = nij;
        if (candidates.length > 0) {
          meta.matched_in = "body";
          meta.body_radicados = candidates.map((c) => c.canonical).slice(0, 5);
        }
        if (ai) {
          meta.ai_classified = true;
          meta.ai_confidence = AI_CONFIDENCE_CAP;
          if (ai.resumen) meta.ai_summary = ai.resumen.slice(0, 200);
          if (ai.audiencia_fecha) meta.audiencia_fecha = ai.audiencia_fecha;
          if (ai.termino_dias) meta.termino_dias = ai.termino_dias;
          if (ai.instancia && ai.instancia !== "00") meta.instance_observed = ai.instancia;
        }

        const nextSubtype = ai?.subtype ?? link.evidence_subtype ?? "OTRO_JUDICIAL";
        const { error: updErr } = await admin
          .from("work_item_email_links")
          .update({
            evidence_subtype: nextSubtype,
            evidence_meta: meta,
            ai_classified: Boolean(ai),
            ai_classified_at: new Date().toISOString(),
          })
          .eq("id", link.id);
        if (updErr) throw new Error(updErr.message);

        summary.processed++;
        summary.by_subtype[nextSubtype] = (summary.by_subtype[nextSubtype] ?? 0) + 1;
        if (ai && nextSubtype !== (link.evidence_subtype ?? "OTRO_JUDICIAL")) {
          summary.reclassified++;
        }

        const { data: effects, error: fxErr } = await admin.rpc(
          "apply_email_evidence_effects",
          { p_link_id: link.id },
        );
        if (fxErr) throw new Error(fxErr.message);
        const fx = (effects ?? {}) as Record<string, unknown>;
        if (fx.deadline_created || fx.stage_created || fx.audiencia_created) {
          summary.effects_emitted++;
        }
      } catch (e) {
        console.error("[email-semantics-backfill]", link.id, (e as Error).message);
        summary.errors++;
        // El mensaje ya no existe en el buzón o el token falló: se marca como
        // intentado (nunca se reintenta en bucle) dejando rastro del motivo.
        await admin
          .from("work_item_email_links")
          .update({
            ai_classified_at: new Date().toISOString(),
            evidence_meta: {
              ...(link.evidence_meta ?? {}),
              ai_backfill_error: (e as Error).message.slice(0, 200),
            },
          })
          .eq("id", link.id);
      }
    }

    let remainingQuery = admin
      .from("work_item_email_links")
      .select("id", { count: "exact", head: true })
      .eq("link_status", "CONFIRMED")
      .eq("direction", "received")
      .is("ai_classified_at", null)
      .or("evidence_subtype.is.null,evidence_subtype.eq.OTRO_JUDICIAL");
    if (userFilter) remainingQuery = remainingQuery.eq("user_id", userFilter);
    const { count } = await remainingQuery;
    summary.remaining = count ?? 0;

    return json({ ok: true, ai_calls: aiState.calls, degraded: aiState.disabled, summary });
  } catch (e) {
    console.error("[email-semantics-backfill]", e);
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
