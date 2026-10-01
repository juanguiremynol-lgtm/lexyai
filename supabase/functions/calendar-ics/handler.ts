// deno-lint-ignore-file no-explicit-any
import { buildIcs, hearingEvent, icsFileName, termEvent } from "../_shared/calendarExport.ts";

export const APP_BASE_URL = "https://andromeda.legal";

/** Minimal data port so the contract is testable without a database. */
export interface CalendarStore {
  token(t: string): Promise<any | null>;
  workItem(id: string): Promise<any | null>;
  term(id: string): Promise<any | null>;
  hearing(id: string): Promise<any | null>;
  bump(t: string): Promise<void>;
}

export interface IcsResult { status: number; body: string; filename?: string }

/**
 * Contract:
 *   404 unknown token / entity no longer eligible (manual review, no date, cancelled)
 *   410 expired token
 *   403 entity does not belong to the token's owner / matter (tenant mismatch)
 *   200 text/calendar
 */
export async function resolveIcs(token: string | null, store: CalendarStore, now = new Date()): Promise<IcsResult> {
  if (!token || !/^[A-Za-z0-9_-]{24,128}$/.test(token)) return { status: 404, body: "Enlace no válido." };
  const tok = await store.token(token);
  if (!tok) return { status: 404, body: "Enlace no válido." };
  if (new Date(tok.expires_at).getTime() <= now.getTime()) return { status: 410, body: "Este enlace venció." };

  const wi = await store.workItem(tok.work_item_id);
  if (!wi || wi.owner_id !== tok.owner_id) return { status: 403, body: "Acceso denegado." };

  let ev = null;
  if (tok.kind === "TERM") {
    const d = await store.term(tok.entity_id);
    if (!d) return { status: 404, body: "No disponible." };
    if (d.work_item_id !== tok.work_item_id) return { status: 403, body: "Acceso denegado." };
    ev = termEvent({ ...d, radicado: wi.radicado, despacho: wi.authority_name }, APP_BASE_URL);
  } else if (tok.kind === "HEARING") {
    const h = await store.hearing(tok.entity_id);
    if (!h) return { status: 404, body: "No disponible." };
    if (h.work_item_id !== tok.work_item_id) return { status: 403, body: "Acceso denegado." };
    ev = hearingEvent({
      id: h.id, work_item_id: h.work_item_id, scheduled_at: h.scheduled_at, status: h.status,
      title: h.custom_name, location: h.location, duration_minutes: h.duration_minutes,
      radicado: wi.radicado, despacho: wi.authority_name,
    }, APP_BASE_URL);
  }
  if (!ev) return { status: 404, body: "Este evento ya no tiene fecha confirmada." };
  await store.bump(token);
  return { status: 200, body: buildIcs(ev, now), filename: icsFileName(ev) };
}
