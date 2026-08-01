/**
 * aiClassifyEmail — Semantic layer over the regex classifier (iteration 5).
 *
 * Guardrails (ratified, non-negotiable):
 *   - Invoked ONLY for judicial counterparts whose regex classification is
 *     opaque (OTRO_JUDICIAL or null).
 *   - The body is read in memory and NEVER persisted: only the subtype, the
 *     extracted identifiers, a <=200-char summary and timestamps are stored.
 *   - Output is validated against the existing evidence_subtype enum; any
 *     parse/validation failure degrades silently to OTRO_JUDICIAL.
 */
import type { EvidenceSubtype } from "./emailMatcher.ts";

export const AI_MODEL = "google/gemini-2.5-flash-lite";
/** Endpoint del gateway de IA de Lovable (chat completions). */
export const AI_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
/** Tope de llamadas al gateway por corrida de sincronización. */
export const AI_CALLS_PER_RUN = 50;
/** El AI nunca supera la certeza del regex/radicado. */
export const AI_CONFIDENCE_CAP = 0.75;
/** Recorte del cuerpo enviado al modelo. */
export const AI_BODY_CHARS = 4_000;

export const AI_SUBTYPES: EvidenceSubtype[] = [
  "ACUSE_AUTOMATICO",
  "ACCESO_EXPEDIENTE",
  "ACTA_REPARTO",
  "INADMISION",
  "AUTO_ADMISORIO",
  "FIJACION_ESTADO",
  "DESISTIMIENTO",
  "RECURSO_CONCEDIDO",
  "FALLO_SENTENCIA",
  "TRASLADO",
  "REQUERIMIENTO",
  "CITACION_AUDIENCIA",
  "NOTIFICACION_PERSONAL",
  "OTRO_JUDICIAL",
];

export interface AiClassification {
  subtype: EvidenceSubtype;
  radicados: string[];
  instancia: string | null;
  audiencia_fecha: string | null;
  termino_dias: number | null;
  resumen: string;
}

const SYSTEM_PROMPT =
  `Eres un clasificador de correo judicial colombiano. Recibes el asunto y el cuerpo de un ` +
  `correo enviado por un despacho judicial. Devuelves EXCLUSIVAMENTE un objeto JSON válido, ` +
  `sin texto adicional ni markdown, con esta forma exacta:\n` +
  `{"subtype":"<uno de: ${AI_SUBTYPES.join("|")}>",` +
  `"radicados":["<radicados de 23 dígitos, solo dígitos>"],` +
  `"instancia":"<00|01|...|null>",` +
  `"audiencia_fecha":"<fecha y hora ISO 8601 de la audiencia citada, o null>",` +
  `"termino_dias":<número de días de término otorgado, o null>,` +
  `"resumen":"<máximo 200 caracteres, en español>"}\n` +
  `Reglas: si el correo cita a una audiencia o diligencia usa CITACION_AUDIENCIA y extrae la ` +
  `fecha y hora. No inventes datos: lo que no aparezca en el texto va como null o lista vacía.`;

/** Sanea y valida la respuesta cruda del modelo. */
export function parseAiClassification(raw: string | null | undefined): AiClassification | null {
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
  const subtype = String(parsed.subtype ?? "").toUpperCase() as EvidenceSubtype;
  if (!AI_SUBTYPES.includes(subtype)) return null;

  const radicados = Array.isArray(parsed.radicados)
    ? parsed.radicados
      .map((r) => String(r).replace(/\D/g, ""))
      .filter((r) => r.length === 21 || r.length === 23)
      .slice(0, 5)
    : [];

  const instanciaRaw = parsed.instancia == null ? null : String(parsed.instancia).replace(/\D/g, "");
  const instancia = instanciaRaw && /^\d{1,2}$/.test(instanciaRaw)
    ? instanciaRaw.padStart(2, "0")
    : null;

  let audiencia: string | null = null;
  if (parsed.audiencia_fecha != null) {
    const value = String(parsed.audiencia_fecha);
    if (!Number.isNaN(Date.parse(value))) audiencia = value;
  }

  const dias = Number(parsed.termino_dias);
  const termino_dias = Number.isFinite(dias) && dias > 0 && dias <= 365 ? Math.floor(dias) : null;

  return {
    subtype,
    radicados,
    instancia,
    audiencia_fecha: audiencia,
    termino_dias,
    resumen: String(parsed.resumen ?? "").slice(0, 200),
  };
}

export interface AiGatewayState {
  calls: number;
  /** El gateway se quedó sin crédito: se degrada a solo-regex y se loguea una vez. */
  disabled: boolean;
  loggedDegradation: boolean;
}

export function newAiGatewayState(): AiGatewayState {
  return { calls: 0, disabled: false, loggedDegradation: false };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Clasifica un mensaje judicial opaco. Devuelve null (degradación silenciosa a
 * OTRO_JUDICIAL) ante cualquier fallo de red, cuota, parseo o validación.
 */
export async function aiClassifyEmail(
  input: { subject: string | null | undefined; bodyText: string },
  state: AiGatewayState,
  apiKey: string | undefined,
): Promise<AiClassification | null> {
  if (!apiKey || state.disabled || state.calls >= AI_CALLS_PER_RUN) return null;
  state.calls++;

  const payload = {
    model: AI_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Asunto: ${input.subject ?? "(sin asunto)"}\n\nCuerpo:\n${
          input.bodyText.slice(0, AI_BODY_CHARS)
        }`,
      },
    ],
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(AI_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 429) {
        await res.text();
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (res.status === 402) {
        await res.text();
        state.disabled = true;
        if (!state.loggedDegradation) {
          state.loggedDegradation = true;
          console.error("[aiClassifyEmail] créditos agotados — degradando a solo-regex");
        }
        return null;
      }
      if (!res.ok) {
        const body = await res.text();
        console.error(`[aiClassifyEmail] gateway [${res.status}]: ${body.slice(0, 300)}`);
        return null;
      }

      const data = await res.json();
      return parseAiClassification(data?.choices?.[0]?.message?.content ?? null);
    } catch (e) {
      console.error("[aiClassifyEmail]", (e as Error).message);
      return null;
    }
  }
  return null;
}
