/**
 * WhatsApp AI Tools — read-only + narrow-write tools the agent can call.
 *
 * All tools are org-scoped: they require a verified identity with
 * organization_id. Category eligibility uses onlineSyncEligibility.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.3";
import { z } from "npm:zod@3.23.8";
import { tool } from "npm:ai@4.0.14";
import { isOnlineSyncEligible } from "./onlineSyncEligibility.ts";

export interface ToolContext {
  supabase: SupabaseClient;
  identityId: string | null;
  userId: string | null;
  organizationId: string | null;
  phoneE164: string;
  correlationId: string;
}

export function makeServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function logToolCall(
  ctx: ToolContext,
  toolName: string,
  input: unknown,
  resultSummary: string,
  workItemId?: string | null,
) {
  await ctx.supabase.from("whatsapp_audit_log").insert({
    phone_e164: ctx.phoneE164,
    user_id: ctx.userId,
    organization_id: ctx.organizationId,
    tool_name: toolName,
    work_item_id: workItemId ?? null,
    correlation_id: ctx.correlationId,
    input: input as never,
    result_summary: resultSummary.slice(0, 500),
  });
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "sin fecha";
  try {
    return new Date(d).toLocaleDateString("es-CO", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(d);
  }
}

export function buildWhatsAppTools(ctx: ToolContext) {
  const requireIdentity = () => {
    if (!ctx.organizationId || !ctx.userId) {
      throw new Error("identity_required");
    }
  };

  return {
    find_work_items: tool({
      description:
        "Busca procesos del abogado por radicado, nombre de cliente o palabra clave. Devuelve una lista corta.",
      parameters: z.object({
        query: z.string().describe("Radicado, nombre de cliente o palabra clave"),
        limit: z.number().int().min(1).max(5).default(5),
      }),
      execute: async ({ query, limit }) => {
        requireIdentity();
        const q = query.trim();
        const { data, error } = await ctx.supabase
          .from("work_items")
          .select("id, title, workflow_type, radicado, current_stage, client_id")
          .eq("organization_id", ctx.organizationId!)
          .or(
            `radicado.ilike.%${q}%,title.ilike.%${q}%`,
          )
          .limit(limit);
        const summary = error
          ? `error: ${error.message}`
          : `found ${data?.length ?? 0}`;
        await logToolCall(ctx, "find_work_items", { query, limit }, summary);
        if (error) return { error: error.message };
        return {
          results: (data ?? []).map((r) => ({
            id: r.id,
            title: r.title,
            radicado: r.radicado,
            workflow_type: r.workflow_type,
            current_stage: r.current_stage,
          })),
        };
      },
    }),

    get_work_item_overview: tool({
      description:
        "Resumen breve de un proceso (título, radicado, estado, última actuación).",
      parameters: z.object({ work_item_id: z.string().uuid() }),
      execute: async ({ work_item_id }) => {
        requireIdentity();
        const { data: wi, error } = await ctx.supabase
          .from("work_items")
          .select(
            "id, title, radicado, workflow_type, current_stage, next_deadline_at",
          )
          .eq("id", work_item_id)
          .eq("organization_id", ctx.organizationId!)
          .maybeSingle();
        if (error || !wi) {
          await logToolCall(ctx, "get_work_item_overview", { work_item_id }, "not_found", work_item_id);
          return { error: "no_encontrado" };
        }
        const { data: lastAct } = await ctx.supabase
          .from("work_item_acts")
          .select("detected_at, description, act_date")
          .eq("work_item_id", work_item_id)
          .order("detected_at", { ascending: false })
          .limit(1);
        await logToolCall(ctx, "get_work_item_overview", { work_item_id }, "ok", work_item_id);
        return {
          work_item: wi,
          last_act: lastAct?.[0] ?? null,
        };
      },
    }),

    get_latest_actuacion: tool({
      description: "Última actuación del proceso.",
      parameters: z.object({ work_item_id: z.string().uuid() }),
      execute: async ({ work_item_id }) => {
        requireIdentity();
        const { data } = await ctx.supabase
          .from("work_item_acts")
          .select("detected_at, act_date, description, act_type")
          .eq("work_item_id", work_item_id)
          .order("detected_at", { ascending: false })
          .limit(1);
        const row = data?.[0] ?? null;
        await logToolCall(ctx, "get_latest_actuacion", { work_item_id }, row ? "ok" : "empty", work_item_id);
        if (!row) return { message: "Sin actuaciones registradas." };
        return {
          fecha: fmtDate(row.act_date ?? row.detected_at),
          descripcion: row.description,
          tipo: row.act_type,
        };
      },
    }),

    get_latest_publicacion: tool({
      description: "Última publicación procesal del proceso.",
      parameters: z.object({ work_item_id: z.string().uuid() }),
      execute: async ({ work_item_id }) => {
        requireIdentity();
        const { data } = await ctx.supabase
          .from("work_item_publicaciones")
          .select("detected_at, publication_date, title, description")
          .eq("work_item_id", work_item_id)
          .order("detected_at", { ascending: false })
          .limit(1);
        const row = data?.[0] ?? null;
        await logToolCall(ctx, "get_latest_publicacion", { work_item_id }, row ? "ok" : "empty", work_item_id);
        if (!row) return { message: "Sin publicaciones registradas." };
        return {
          fecha: fmtDate(row.publication_date ?? row.detected_at),
          titulo: row.title,
          descripcion: row.description,
        };
      },
    }),

    get_upcoming_deadlines: tool({
      description: "Próximos vencimientos del proceso.",
      parameters: z.object({
        work_item_id: z.string().uuid(),
        limit: z.number().int().min(1).max(5).default(3),
      }),
      execute: async ({ work_item_id, limit }) => {
        requireIdentity();
        const { data } = await ctx.supabase
          .from("work_item_deadlines")
          .select("due_at, label, status")
          .eq("work_item_id", work_item_id)
          .gte("due_at", new Date().toISOString())
          .order("due_at", { ascending: true })
          .limit(limit);
        await logToolCall(ctx, "get_upcoming_deadlines", { work_item_id }, `n=${data?.length ?? 0}`, work_item_id);
        return {
          deadlines: (data ?? []).map((d) => ({
            fecha: fmtDate(d.due_at),
            descripcion: d.label,
            estado: d.status,
          })),
        };
      },
    }),

    request_refresh: tool({
      description:
        "Solicita una nueva consulta al proveedor externo del proceso. Sólo para categorías con sincronización externa.",
      parameters: z.object({ work_item_id: z.string().uuid() }),
      execute: async ({ work_item_id }) => {
        requireIdentity();
        const { data: wi } = await ctx.supabase
          .from("work_items")
          .select("id, workflow_type, organization_id")
          .eq("id", work_item_id)
          .eq("organization_id", ctx.organizationId!)
          .maybeSingle();
        if (!wi) {
          await logToolCall(ctx, "request_refresh", { work_item_id }, "not_found", work_item_id);
          return { error: "no_encontrado" };
        }
        if (!isOnlineSyncEligible(wi.workflow_type)) {
          await logToolCall(ctx, "request_refresh", { work_item_id }, "not_applicable", work_item_id);
          return {
            error: "not_applicable",
            message:
              "Este tipo de proceso no admite consulta externa automática.",
          };
        }
        const { error } = await ctx.supabase.from("sync_retry_queue").insert({
          work_item_id,
          reason: "whatsapp_refresh",
          priority: 5,
        } as never);
        const ok = !error;
        await logToolCall(ctx, "request_refresh", { work_item_id }, ok ? "enqueued" : `err:${error?.message}`, work_item_id);
        return ok
          ? { message: "Consulta programada. Te avisaré cuando llegue novedad." }
          : { error: "no_se_pudo_programar" };
      },
    }),

    create_lead: tool({
      description:
        "Registra un prospecto nuevo (usuario NO verificado interesado en el servicio).",
      parameters: z.object({
        name: z.string().nullable(),
        firm: z.string().nullable(),
        city: z.string().nullable(),
        interest_summary: z.string(),
      }),
      execute: async ({ name, firm, city, interest_summary }) => {
        const { data, error } = await ctx.supabase
          .from("whatsapp_leads")
          .insert({
            phone_e164: ctx.phoneE164,
            name,
            firm,
            city,
            interest_summary,
            status: "new",
          } as never)
          .select("id")
          .maybeSingle();
        await logToolCall(ctx, "create_lead", { name, firm, city }, error ? `err:${error.message}` : "ok");
        if (error) return { error: error.message };
        return { id: (data as { id?: string } | null)?.id, message: "Lead registrado." };
      },
    }),

    escalate_to_human: tool({
      description: "Marca la conversación como necesita atención humana.",
      parameters: z.object({ reason: z.string() }),
      execute: async ({ reason }) => {
        await ctx.supabase
          .from("whatsapp_conversations")
          .update({ status: "needs_human", metadata: { escalation_reason: reason } } as never)
          .eq("phone_e164", ctx.phoneE164);
        await logToolCall(ctx, "escalate_to_human", { reason }, "ok");
        return { message: "Conversación escalada." };
      },
    }),
  };
}
