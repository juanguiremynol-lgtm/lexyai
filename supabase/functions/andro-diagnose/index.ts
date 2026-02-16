/**
 * andro-diagnose — Read-only diagnostic playbooks for Andro IA.
 *
 * Playbooks:
 *   - WHY_NO_UPDATES: Why didn't my updates appear today?
 *   - MISSING_DATA: Why are there missing estados/actuaciones?
 *   - PERMISSIONS_CHECK: Is this a permissions issue?
 *   - DEAD_LETTER_STATUS: Why is this item excluded?
 *
 * NO SYNC ACTIONS. Read-only evidence collection + Gemini explanation.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Playbook = "WHY_NO_UPDATES" | "MISSING_DATA" | "PERMISSIONS_CHECK" | "DEAD_LETTER_STATUS";

interface DiagnosticResult {
  playbook: Playbook;
  summary: string;
  evidence: Record<string, unknown>;
  recommended_actions: string[];
  next_cron_estimate: string | null;
}

function estimateNextCron(): string {
  // Daily sync runs at 07:00 COT (12:00 UTC)
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setUTCHours(12, 0, 0, 0);
  if (now.getTime() > nextRun.getTime()) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  return nextRun.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const playbook = body.playbook as Playbook;
    const workItemId = body.work_item_id as string | undefined;

    if (!playbook) {
      return new Response(JSON.stringify({ error: "Missing playbook parameter" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user profile
    const { data: profile } = await userClient
      .from("profiles")
      .select("id, full_name, organization_id")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = profile?.organization_id;

    // Get membership role
    let membershipRole = "MEMBER";
    let isOrgAdmin = false;
    if (orgId) {
      const { data: membership } = await adminClient
        .from("organization_memberships")
        .select("role")
        .eq("organization_id", orgId)
        .eq("user_id", user.id)
        .maybeSingle();
      membershipRole = membership?.role || "MEMBER";
      isOrgAdmin = membershipRole === "OWNER" || membershipRole === "ADMIN";
    }

    // Get tier
    let tier = "TRIAL";
    if (orgId) {
      const { data: sub } = await adminClient
        .from("billing_subscription_state")
        .select("plan_code")
        .eq("organization_id", orgId)
        .maybeSingle();
      tier = sub?.plan_code || "TRIAL";
    }
    const isBusiness = ["BUSINESS", "PRO", "ENTERPRISE"].includes(tier.toUpperCase());

    const nextCron = estimateNextCron();
    let result: DiagnosticResult;

    switch (playbook) {
      case "WHY_NO_UPDATES": {
        const evidence: Record<string, unknown> = { next_cron: nextCron };

        // Get last daily sync for this org
        if (orgId) {
          const { data: lastLedger } = await adminClient
            .from("auto_sync_daily_ledger")
            .select("id, run_date, status, items_targeted, items_succeeded, items_failed, timeout_count, dead_letter_count, started_at, completed_at, failure_reason")
            .eq("organization_id", orgId)
            .order("run_date", { ascending: false })
            .limit(3);
          evidence.recent_syncs = lastLedger ?? [];
        }

        // Check specific work item if provided
        if (workItemId) {
          const { data: wi } = await userClient
            .from("work_items")
            .select("id, radicado, monitoring_enabled, monitoring_disabled_reason, last_synced_at, last_error_code, consecutive_failures, scrape_status")
            .eq("id", workItemId)
            .maybeSingle();
          evidence.work_item = wi;

          if (wi) {
            // Check if dead-lettered
            const { data: aiState } = await adminClient
              .from("atenia_ai_work_item_state")
              .select("consecutive_not_found, consecutive_timeouts, last_error_code, last_observed_at")
              .eq("work_item_id", workItemId)
              .maybeSingle();
            evidence.ai_state = aiState;

            // Is monitoring enabled?
            if (!wi.monitoring_enabled) {
              evidence.issue = "MONITORING_DISABLED";
            }
            // Dead-lettered?
            else if (aiState && (aiState.consecutive_not_found >= 3 || aiState.consecutive_timeouts >= 3)) {
              evidence.issue = "DEAD_LETTERED";
            }
            // Recent errors?
            else if (wi.last_error_code) {
              evidence.issue = "PROVIDER_ERROR";
            }
          }
        }

        const summaryParts: string[] = [];
        const actions: string[] = [];

        const issue = evidence.issue as string;
        if (issue === "MONITORING_DISABLED") {
          summaryParts.push("El monitoreo está desactivado para este asunto.");
          actions.push("Contacta a tu administrador para reactivar el monitoreo.");
        } else if (issue === "DEAD_LETTERED") {
          summaryParts.push("Este asunto fue excluido del sync automático después de fallos repetidos.");
          actions.push("Genera un bundle de soporte y envíalo al equipo de soporte para revisión.");
        } else if (issue === "PROVIDER_ERROR") {
          summaryParts.push(`El último intento de sync falló con error: ${(evidence.work_item as any)?.last_error_code}`);
          actions.push("Espera al próximo ciclo de sync diario para un reintento automático.");
        } else {
          summaryParts.push("No se detectaron problemas específicos.");
        }

        summaryParts.push(`Próximo sync diario estimado: ${nextCron}`);
        actions.push("Si el problema persiste después del próximo sync, genera un bundle de soporte.");

        result = {
          playbook: "WHY_NO_UPDATES",
          summary: summaryParts.join(" "),
          evidence,
          recommended_actions: actions,
          next_cron_estimate: nextCron,
        };
        break;
      }

      case "MISSING_DATA": {
        const evidence: Record<string, unknown> = {};

        if (!workItemId) {
          result = {
            playbook: "MISSING_DATA",
            summary: "Se necesita un asunto específico para diagnosticar datos faltantes.",
            evidence: {},
            recommended_actions: ["Abre el asunto que quieres diagnosticar e intenta de nuevo."],
            next_cron_estimate: nextCron,
          };
          break;
        }

        // Get work item
        const { data: wi } = await userClient
          .from("work_items")
          .select("id, radicado, workflow_type, total_actuaciones, provider_sources, last_synced_at, last_error_code")
          .eq("id", workItemId)
          .maybeSingle();
        evidence.work_item = wi;

        if (!wi) {
          result = {
            playbook: "MISSING_DATA",
            summary: "No se encontró el asunto o no tienes acceso.",
            evidence: {},
            recommended_actions: ["Verifica que el radicado esté correcto."],
            next_cron_estimate: nextCron,
          };
          break;
        }

        // Data counts
        const { count: actsCount } = await userClient
          .from("work_item_acts")
          .select("id", { count: "exact", head: true })
          .eq("work_item_id", workItemId);
        const { count: pubsCount } = await userClient
          .from("work_item_publicaciones")
          .select("id", { count: "exact", head: true })
          .eq("work_item_id", workItemId);

        evidence.data_counts = { actuaciones: actsCount ?? 0, publicaciones: pubsCount ?? 0 };

        // Recent trace outcomes
        const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const { data: traces } = await userClient
          .from("sync_traces")
          .select("step, success, error_code, latency_ms, created_at")
          .eq("work_item_id", workItemId)
          .gte("created_at", since48h)
          .order("created_at", { ascending: false })
          .limit(10);
        evidence.recent_traces = traces ?? [];

        const successTraces = (traces ?? []).filter((t: any) => t.success);
        const failTraces = (traces ?? []).filter((t: any) => !t.success);

        const summaryParts: string[] = [];
        if ((actsCount ?? 0) === 0 && (pubsCount ?? 0) === 0) {
          summaryParts.push("No hay datos registrados para este asunto.");
          if (failTraces.length > 0) {
            summaryParts.push(`Los últimos ${failTraces.length} intentos de obtener datos fallaron.`);
          }
        } else {
          summaryParts.push(`Datos actuales: ${actsCount} actuaciones, ${pubsCount} estados.`);
          if (failTraces.length > 0) {
            summaryParts.push(`${failTraces.length} de ${(traces ?? []).length} trazas recientes fallaron.`);
          }
        }

        result = {
          playbook: "MISSING_DATA",
          summary: summaryParts.join(" "),
          evidence,
          recommended_actions: [
            "Si no hay datos, espera al próximo sync diario.",
            "Si el problema persiste, genera un bundle de soporte.",
          ],
          next_cron_estimate: nextCron,
        };
        break;
      }

      case "PERMISSIONS_CHECK": {
        const evidence: Record<string, unknown> = {
          user_id: user.id,
          org_id: orgId,
          membership_role: membershipRole,
          is_org_admin: isOrgAdmin,
          tier,
          is_business: isBusiness,
        };

        const summaryParts: string[] = [];

        if (!orgId) {
          summaryParts.push("No perteneces a ninguna organización.");
          summaryParts.push("Solo puedes ver tus propios asuntos.");
        } else if (isBusiness && isOrgAdmin) {
          summaryParts.push(`Eres administrador (${membershipRole}) en un plan ${tier}.`);
          summaryParts.push("Puedes ver todos los asuntos de tu organización.");
        } else if (isBusiness) {
          summaryParts.push(`Eres miembro en un plan ${tier}.`);
          summaryParts.push("Solo puedes ver tus propios asuntos (no los de otros miembros).");
        } else {
          summaryParts.push(`Eres ${membershipRole} en un plan ${tier}.`);
          summaryParts.push("Solo puedes ver tus propios asuntos.");
          if (isOrgAdmin) {
            summaryParts.push("Nota: eres administrador, pero tu plan no incluye visibilidad org-wide.");
          }
        }

        result = {
          playbook: "PERMISSIONS_CHECK",
          summary: summaryParts.join(" "),
          evidence,
          recommended_actions: [],
          next_cron_estimate: null,
        };
        break;
      }

      case "DEAD_LETTER_STATUS": {
        const evidence: Record<string, unknown> = {};

        if (workItemId) {
          const { data: aiState } = await adminClient
            .from("atenia_ai_work_item_state")
            .select("*")
            .eq("work_item_id", workItemId)
            .maybeSingle();
          evidence.ai_state = aiState;

          const isDeadLettered = aiState && (
            aiState.consecutive_not_found >= 3 ||
            aiState.consecutive_timeouts >= 3 ||
            aiState.consecutive_other_errors >= 3
          );
          evidence.is_dead_lettered = !!isDeadLettered;

          if (isDeadLettered) {
            result = {
              playbook: "DEAD_LETTER_STATUS",
              summary: `Este asunto fue excluido del sync automático. Razón: ${aiState?.last_error_code || "fallos consecutivos"}. Última observación: ${aiState?.last_observed_at || "desconocida"}.`,
              evidence,
              recommended_actions: [
                "Genera un bundle de soporte y envíalo al equipo para que revisen y puedan reactivar este ítem.",
                "No es posible reactivar ítems dead-lettered desde la interfaz de usuario.",
              ],
              next_cron_estimate: null,
            };
          } else {
            result = {
              playbook: "DEAD_LETTER_STATUS",
              summary: "Este asunto NO está dead-lettered. Se incluye normalmente en el sync diario.",
              evidence,
              recommended_actions: [],
              next_cron_estimate: estimateNextCron(),
            };
          }
        } else {
          // Org-wide dead letter summary (BUSINESS admin only)
          if (orgId && isOrgAdmin && isBusiness) {
            const { data: deadItems } = await adminClient
              .from("atenia_ai_work_item_state")
              .select("work_item_id, last_error_code, consecutive_not_found, consecutive_timeouts, last_observed_at")
              .eq("organization_id", orgId)
              .or("consecutive_not_found.gte.3,consecutive_timeouts.gte.3,consecutive_other_errors.gte.3")
              .limit(50);
            evidence.dead_lettered_items = deadItems ?? [];
            evidence.dead_lettered_count = (deadItems ?? []).length;

            result = {
              playbook: "DEAD_LETTER_STATUS",
              summary: `Tu organización tiene ${(deadItems ?? []).length} asuntos excluidos del sync automático.`,
              evidence,
              recommended_actions: [
                "Genera un bundle de soporte para cada asunto afectado.",
              ],
              next_cron_estimate: null,
            };
          } else {
            result = {
              playbook: "DEAD_LETTER_STATUS",
              summary: "Selecciona un asunto específico para verificar su estado de dead-letter.",
              evidence: {},
              recommended_actions: [],
              next_cron_estimate: null,
            };
          }
        }
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown playbook: ${playbook}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    // Log action
    await adminClient.from("atenia_assistant_actions").insert({
      organization_id: orgId,
      user_id: user.id,
      action_type: `DIAGNOSE_${playbook}`,
      work_item_id: workItemId || null,
      input: { playbook, work_item_id: workItemId },
      result: { summary: result.summary },
      status: "EXECUTED",
    }).catch(() => {});

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    console.error("[andro-diagnose] Error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
