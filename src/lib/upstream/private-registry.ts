/**
 * private-registry.ts — ITER46. App-side mirror of the parser used by
 * `sync-detalle-exposicion`. `/reserva/estado` returns the REGISTRY of private
 * matters, not a per-item lookup (verified live: probing one radicado answered
 * with another). Membership = PROCESO_PRIVADO; absence from a registry that was
 * read successfully = exposed; an unparseable payload asserts nothing.
 */
export interface ExposicionReading {
  expuesto: boolean | null;
  motivo: string | null;
  desde: string | null;
  ultima_verificacion: string | null;
  ttl_days: number | null;
  raw: Record<string, unknown> | null;
}

export interface PrivateRegistry {
  /** Keyed by digits-only radicado. Only matters the provider marks private. */
  entries: Map<string, ExposicionReading>;
  /** False when the read failed; then the registry asserts nothing at all. */
  conclusive: boolean;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Parse the registry of private matters. A payload we cannot understand is
 * NON-CONCLUSIVE, never an empty registry: an empty registry would silently
 * declare the whole portfolio exposed.
 */
export function parsePrivateRegistry(payload: unknown): PrivateRegistry {
  const empty: PrivateRegistry = { entries: new Map(), conclusive: false };
  if (!payload || typeof payload !== "object") return empty;
  const root = payload as Record<string, unknown>;
  const list = root.radicados ?? root.data ?? root.items;
  if (!Array.isArray(list)) return empty;

  const entries = new Map<string, ExposicionReading>();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    const key = String(b.radicado ?? b.numero_radicacion ?? "").replace(/\D/g, "");
    if (!key) continue;

    const flag = b.en_reserva ?? b.es_privado ?? b.privado;
    // The registry only lists private matters; an absent flag still means listed.
    if (flag === false) continue;

    const ttlRaw = b.ttl_days ?? b.ttlDias ?? b.ttl;
    entries.set(key, {
      expuesto: false,
      motivo: str(b.motivo) ?? "PROCESO_PRIVADO",
      desde: str(b.desde) ?? str(b.inicio),
      ultima_verificacion: str(b.ultima_verificacion) ?? str(b.ultimaVerificacion),
      ttl_days: typeof ttlRaw === "number" && Number.isFinite(ttlRaw) ? ttlRaw : null,
      raw: b,
    });
  }
  return { entries, conclusive: true };
}

/** Reading for one matter, given a registry that was read successfully. */
export function readingFor(registry: PrivateRegistry, radicado: string): ExposicionReading {
  const key = String(radicado ?? "").replace(/\D/g, "");
  const hit = registry.entries.get(key);
  if (hit) return hit;
  return {
    expuesto: registry.conclusive ? true : null,
    motivo: null, desde: null, ultima_verificacion: null, ttl_days: null, raw: null,
  };
}

