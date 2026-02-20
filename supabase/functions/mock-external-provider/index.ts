/**
 * mock-external-provider — Deterministic mock responses for all 5 external APIs.
 *
 * Env-gated: only works when ATENIA_ENABLE_PROVIDER_MOCKS=true.
 * Returns payloads that match each provider's real schema so the existing
 * mappingEngine + upsert RPCs process them identically to live data.
 *
 * Accepts: { api_kind, radicado, scenario, seed }
 * api_kind: CPNU | SAMAI | PUBLICACIONES | TUTELAS | SAMAI_ESTADOS
 * scenario: NEW_MOVEMENT | MODIFIED_MOVEMENT | EMPTY | ERROR_TIMEOUT | ERROR_404
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session",
};

interface MockRequest {
  api_kind?: string;
  radicado?: string;
  provider_case_id?: string;
  scenario?: string;
  seed?: number;
  since?: string;
  include?: string[];
  // Health check
  health_check?: boolean;
}

function deterministicId(seed: number, suffix: string): string {
  const base = `mock-${seed}-${suffix}`;
  // Simple deterministic hash-like id
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function yesterdayDate(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── CPNU Mock ────────────────────────────────────────────────────────
function cpnuPayload(radicado: string, scenario: string, seed: number) {
  if (scenario === "EMPTY") return { actuaciones: [] };
  if (scenario === "ERROR_404") return { error: "Radicado no encontrado", code: "NOT_FOUND" };

  const baseAct = {
    idRegActuacion: deterministicId(seed, "cpnu-act"),
    consActuacion: 1,
    fechaActuacion: yesterdayDate(), // backdated to exercise detected_at
    fechaRegistro: new Date().toISOString(),
    actuacion: scenario === "MODIFIED_MOVEMENT"
      ? "AUTO INTERLOCUTORIO - Modificado por mock (anotación actualizada)"
      : "AUTO INTERLOCUTORIO - Fija fecha para audiencia inicial",
    anotacion: scenario === "MODIFIED_MOVEMENT"
      ? `Anotación MODIFICADA por mock E2E (seed=${seed}): Se modifica la fecha de audiencia.`
      : `Anotación original mock E2E (seed=${seed}): Se fija fecha de audiencia para el próximo mes.`,
    existDocument: false,
    cant: 0,
    codRegla: "00",
    conlesProcesoRama: radicado,
    esPrivado: false,
  };

  return { actuaciones: [baseAct] };
}

// ─── SAMAI Mock ───────────────────────────────────────────────────────
function samaiPayload(radicado: string, scenario: string, seed: number) {
  if (scenario === "EMPTY") return { actuaciones: [] };
  if (scenario === "ERROR_404") return { error: "Proceso no encontrado", code: "RECORD_NOT_FOUND" };

  return {
    actuaciones: [{
      id: deterministicId(seed, "samai-act"),
      fechaActuacion: yesterdayDate(),
      fechaRegistro: new Date().toISOString(),
      tipoActuacion: "Auto",
      descripcion: scenario === "MODIFIED_MOVEMENT"
        ? `Auto interlocutorio SAMAI mock MODIFICADO (seed=${seed})`
        : `Auto interlocutorio SAMAI mock (seed=${seed})`,
      anotacion: scenario === "MODIFIED_MOVEMENT"
        ? "Anotación SAMAI modificada por test E2E"
        : "Anotación SAMAI original mock E2E",
      radicado,
    }],
  };
}

// ─── Publicaciones Mock ───────────────────────────────────────────────
function publicacionesPayload(radicado: string, scenario: string, seed: number) {
  if (scenario === "EMPTY") return { publicaciones: [] };
  if (scenario === "ERROR_404") return { error: "Sin publicaciones", code: "NOT_FOUND" };

  return {
    publicaciones: [{
      id: deterministicId(seed, "pub"),
      fechaFijacion: yesterdayDate(),
      fechaDesfijacion: todayDate(),
      titulo: scenario === "MODIFIED_MOVEMENT"
        ? `Estado MODIFICADO mock E2E (seed=${seed})`
        : `Fijación en lista mock E2E (seed=${seed})`,
      tipoPublicacion: "AUTO INTERLOCUTORIO",
      radicado,
      proceso: radicado,
    }],
  };
}

// ─── Tutelas Mock ─────────────────────────────────────────────────────
function tutelasPayload(radicado: string, scenario: string, seed: number) {
  if (scenario === "EMPTY") return { actuaciones: [] };
  if (scenario === "ERROR_404") return { error: "Tutela no encontrada", code: "RECORD_NOT_FOUND" };

  return {
    actuaciones: [{
      id: deterministicId(seed, "tutela-act"),
      fechaActuacion: yesterdayDate(),
      fechaRegistro: new Date().toISOString(),
      tipo: "Providencia",
      descripcion: scenario === "MODIFIED_MOVEMENT"
        ? `Sentencia tutela MODIFICADA mock (seed=${seed})`
        : `Sentencia tutela primera instancia mock (seed=${seed})`,
      anotacion: "Mock tutela anotación E2E",
      radicado,
    }],
  };
}

// ─── SAMAI Estados Mock ───────────────────────────────────────────────
function samaiEstadosPayload(radicado: string, scenario: string, seed: number) {
  if (scenario === "EMPTY") return { estados: [] };
  if (scenario === "ERROR_404") return { error: "Sin estados", code: "NOT_FOUND" };

  return {
    estados: [{
      id: deterministicId(seed, "samai-estado"),
      fechaFijacion: yesterdayDate(),
      fechaDesfijacion: todayDate(),
      titulo: scenario === "MODIFIED_MOVEMENT"
        ? `Estado SAMAI MODIFICADO mock (seed=${seed})`
        : `Estado SAMAI fijación en lista mock (seed=${seed})`,
      tipoPublicacion: "AUTO",
      radicado,
    }],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Env gate ──
  const mocksEnabled = Deno.env.get("ATENIA_ENABLE_PROVIDER_MOCKS") === "true";
  if (!mocksEnabled) {
    return new Response(
      JSON.stringify({ error: "Provider mocks are disabled. Set ATENIA_ENABLE_PROVIDER_MOCKS=true." }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body: MockRequest = await req.json();

    // Health check
    if (body.health_check) {
      return new Response(
        JSON.stringify({ status: "OK", function: "mock-external-provider", mocks_enabled: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKind = (body.api_kind ?? "CPNU").toUpperCase();
    const radicado = body.radicado || body.provider_case_id || "00000000000000000000000";
    const scenario = (body.scenario ?? "NEW_MOVEMENT").toUpperCase();
    const seed = body.seed ?? Date.now();

    // Simulate timeout
    if (scenario === "ERROR_TIMEOUT") {
      await new Promise(resolve => setTimeout(resolve, 35000));
      return new Response("Timeout", { status: 504, headers: corsHeaders });
    }

    let payload: unknown;
    switch (apiKind) {
      case "CPNU": payload = cpnuPayload(radicado, scenario, seed); break;
      case "SAMAI": payload = samaiPayload(radicado, scenario, seed); break;
      case "PUBLICACIONES": payload = publicacionesPayload(radicado, scenario, seed); break;
      case "TUTELAS": payload = tutelasPayload(radicado, scenario, seed); break;
      case "SAMAI_ESTADOS": payload = samaiEstadosPayload(radicado, scenario, seed); break;
      default:
        return new Response(
          JSON.stringify({ error: `Unknown api_kind: ${apiKind}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    // Wrap in snapshot envelope (as real providers do)
    const response = {
      ok: scenario !== "ERROR_404",
      data: payload,
      provider: apiKind,
      radicado,
      timestamp: new Date().toISOString(),
      mock: true,
      seed,
      scenario,
    };

    const status = scenario === "ERROR_404" ? 404 : 200;
    return new Response(JSON.stringify(response), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
