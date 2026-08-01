/**
 * aiVerifyLink.ts — ITERACIÓN 6, Parte C.
 *
 * Verificación semántica de IDENTIDAD del vínculo (no del subtipo). Se invoca
 * SOLO para candidatos multi-señal (nombre + despacho): los matches por
 * radicado son deterministas y nunca pasan por aquí.
 *
 * Garantías:
 *   - El cuerpo se lee en memoria y NUNCA se persiste (solo el veredicto y
 *     hasta 3 razones cortas).
 *   - La IA jamás auto-confirma: como máximo permite que el candidato llegue
 *     a la cola de SUGERIDOS.
 *   - Ante 402 (créditos), 429 persistente o cualquier fallo de parseo, se
 *     degrada a las reglas multi-señal de la Parte B.
 */
import { AI_CALLS_PER_RUN, type AiGatewayState } from "./aiClassifyEmail.ts";

/** Endpoint Responses de Lovable AI Gateway (modelo OpenAI de razonamiento). */
export const AI_VERIFY_ENDPOINT = "https://ai.gateway.lovable.dev/v1/responses";
export const AI_VERIFY_MODEL = "openai/gpt-5.6-sol";
export const AI_VERIFY_BODY_CHARS = 4_000;

export interface WorkItemFacts {
  radicado: string | null;
  demandantes: string | null;
  demandados: string | null;
  authority_name: string | null;
  authority_city: string | null;
  workflow_type: string | null;
}

export interface AiLinkVerdict {
  verdict: "MATCH" | "NO_MATCH" | "UNSURE";
  reasons: string[];
  conflicting_radicado: string | null;
}

/**
 * Marcador de salud: la degradación de la Parte C es silenciosa por diseño,
 * así que cada llamada al gateway deja huella en `system_health_heartbeat`
 * (servicio AI_VERIFY_LINK) para que la UI de administración pueda mostrar
 * "Verificación IA: activa / degradada".
 */
export const AI_VERIFY_HEALTH_SERVICE = "AI_VERIFY_LINK";

export type AiVerifyHealthSink = (
  health: { ok: boolean; message?: string },
) => void | Promise<void>;

/** Construye un sink que persiste el latido usando un cliente service-role. */
export function makeAiVerifyHealthSink(
  admin: { from: (t: string) => any },
): AiVerifyHealthSink {
  return async ({ ok, message }) => {
    const now = new Date().toISOString();
    try {
      await admin.from("system_health_heartbeat").upsert({
        service: AI_VERIFY_HEALTH_SERVICE,
        last_status: ok ? "OK" : "ERROR",
        last_message: message ? String(message).slice(0, 300) : (ok ? AI_VERIFY_MODEL : null),
        ...(ok ? { last_ok_at: now } : { last_error_at: now }),
        updated_at: now,
      }, { onConflict: "service" });
    } catch (e) {
      console.error("[aiVerifyLink] no se pudo persistir el latido:", (e as Error).message);
    }
  };
}

const SYSTEM_PROMPT =
  "Eres un verificador de identidad procesal colombiano. Recibes los datos de " +
  "un expediente y un correo. Decides si el correo pertenece A ESE expediente. " +
  "Un despacho judicial lleva muchos procesos: coincidir el juzgado NO basta. " +
  "Responde EXCLUSIVAMENTE un JSON: " +
  '{"verdict":"MATCH|NO_MATCH|UNSURE","reasons":["<=3 razones cortas en español>"],' +
  '"conflicting_radicado":"<radicado del correo que contradice al del expediente, o null>"}';

/** Sanea la respuesta cruda del modelo. */
export function parseAiVerdict(raw: string | null | undefined): AiLinkVerdict | null {
  if (!raw) return null;
  const text = String(raw).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const verdict = String(parsed.verdict ?? "").toUpperCase();
  if (verdict !== "MATCH" && verdict !== "NO_MATCH" && verdict !== "UNSURE") return null;
  const reasons = Array.isArray(parsed.reasons)
    ? parsed.reasons.map((r) => String(r).slice(0, 160)).filter(Boolean).slice(0, 3)
    : [];
  const conflict = parsed.conflicting_radicado == null
    ? null
    : String(parsed.conflicting_radicado).replace(/\D/g, "") || null;
  return { verdict: verdict as AiLinkVerdict["verdict"], reasons, conflicting_radicado: conflict };
}

/** Acumula los deltas SSE de /v1/responses (toda llamada debe ser streaming). */
async function readResponsesStream(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
          out += evt.delta;
        } else if (evt.type === "response.completed" && typeof evt.response?.output_text === "string") {
          out = evt.response.output_text;
        }
      } catch { /* fragmento parcial */ }
    }
  }
  return out;
}

/**
 * Verifica un candidato de vínculo. Devuelve null (degradación silenciosa a
 * las reglas multi-señal) ante cualquier fallo.
 */
export async function aiVerifyLink(
  input: {
    wi: WorkItemFacts;
    subject: string | null | undefined;
    sender: string | null | undefined;
    bodyText: string;
    signals: string[];
  },
  state: AiGatewayState,
  apiKey: string | undefined,
  health?: AiVerifyHealthSink,
): Promise<AiLinkVerdict | null> {
  if (!apiKey || state.disabled || state.calls >= AI_CALLS_PER_RUN) return null;
  state.calls++;

  const prompt = [
    "EXPEDIENTE:",
    `- radicado: ${input.wi.radicado ?? "(sin radicado)"}`,
    `- demandantes: ${input.wi.demandantes ?? "(sin dato)"}`,
    `- demandados: ${input.wi.demandados ?? "(sin dato)"}`,
    `- despacho: ${input.wi.authority_name ?? "(sin dato)"} (${input.wi.authority_city ?? "-"})`,
    `- tipo: ${input.wi.workflow_type ?? "(sin dato)"}`,
    `- señales detectadas por reglas: ${input.signals.join(", ") || "(ninguna)"}`,
    "",
    "CORREO:",
    `- remitente: ${input.sender ?? "(desconocido)"}`,
    `- asunto: ${input.subject ?? "(sin asunto)"}`,
    `- cuerpo:\n${input.bodyText.slice(0, AI_VERIFY_BODY_CHARS)}`,
  ].join("\n");

  try {
    const res = await fetch(AI_VERIFY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: AI_VERIFY_MODEL,
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        stream: true,
        store: false,
        reasoning: { effort: "low", summary: "auto" },
      }),
    });

    if (res.status === 402) {
      await res.body?.cancel();
      state.disabled = true;
      await health?.({ ok: false, message: "402 créditos agotados" });
      if (!state.loggedDegradation) {
        state.loggedDegradation = true;
        console.error("[aiVerifyLink] créditos agotados — degradando a reglas multi-señal");
      }
      return null;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      await health?.({ ok: false, message: `HTTP ${res.status}: ${body.slice(0, 200)}` });
      console.error(`[aiVerifyLink] gateway [${res.status}]: ${body.slice(0, 300)}`);
      return null;
    }
    const verdict = parseAiVerdict(await readResponsesStream(res));
    await health?.(
      verdict
        ? { ok: true, message: `${AI_VERIFY_MODEL} · ${verdict.verdict}` }
        : { ok: false, message: "respuesta no interpretable del modelo" },
    );
    return verdict;
  } catch (e) {
    await health?.({ ok: false, message: (e as Error).message });
    console.error("[aiVerifyLink]", (e as Error).message);
    return null;
  }
}
