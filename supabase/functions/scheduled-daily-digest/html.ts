/**
 * html.ts — renderer for the consolidated daily digest.
 *
 * HH2(a): ACTUACIONES and ESTADOS get their own table, their own header, their
 * own colour and their own column set. They are never merged into one list and
 * never rendered identically.
 * HH2(d): both dates are shown and labelled — "fecha de actuación" (the act's
 * date in the expediente) and "fecha de fijación" (when the estado was posted).
 * HH3(c) / KK3(b): a row with no document says "sin documento adjunto" only
 * when the provider was asked; otherwise "aún no consultado". Never hidden.

 */

import { describeSourceQuality } from "../_shared/sourceRunQuality.ts";
import {
  BOUND_PARTY_SHORT,
  actuacionSourceLabel,
  estadoSourceLabel,
  type ActuacionRow,
  type ConnectionIssueRow,
  type DocumentAvailability,
  type DeadlineRow,
  type DigestDocument,
  type DigestPayload,
  type EstadoRow,
  type HearingRow,
  type ReconciliationNoticeRow,
  type SourceQualityRow,
  type SuspendedItemRow,
  type WorkItemInfo,
} from "./types.ts";

const BG = "#0f172a";
const CARD = "#111c34";
const BORDER = "#334155";
const TEXT = "#e2e8f0";
const MUTED = "#94a3b8";
const ACT_ACCENT = "#38bdf8"; // actuación
const EST_ACCENT = "#a78bfa"; // estado

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v.length <= 10 ? `${v}T12:00:00Z` : v);
  if (Number.isNaN(d.getTime())) return esc(v);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Bogota" });
}

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return esc(v);
  return d.toLocaleString("es-CO", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota",
  });
}

function docsCell(
  docs: DigestDocument[],
  expiryDays: number,
  availability: DocumentAvailability = "SIN_DOCUMENTO",
): string {
  if (!docs.length) {
    // KK3(b) — "sin documento adjunto" is only said when the provider was
    // actually asked. Otherwise the honest statement is that nobody asked.
    if (availability === "NO_CONSULTADO") {
      return `<span style="color:${MUTED};font-style:italic;">Aún no consultado con el proveedor</span>`;
    }
    return `<span style="color:${MUTED};font-style:italic;">Sin documento adjunto</span>`;
  }
  return docs
    .map(
      (d) =>
        `<a href="${esc(d.url)}" style="color:${ACT_ACCENT};text-decoration:underline;">📎 ${esc(d.label)}</a>`,
    )
    .join("<br/>") +
    `<div style="color:${MUTED};font-size:11px;margin-top:3px;">Enlace válido ${expiryDays} días</div>`;
}


function th(label: string, accent: string): string {
  return `<th style="text-align:left;padding:7px 9px;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:${accent};border-bottom:1px solid ${BORDER};white-space:nowrap;">${esc(label)}</th>`;
}

function td(content: string): string {
  return `<td style="padding:8px 9px;font-size:13px;color:${TEXT};border-bottom:1px solid #1e293b;vertical-align:top;">${content}</td>`;
}

function partes(wi: WorkItemInfo | undefined): string {
  const a = (wi?.demandantes || "").trim();
  const b = (wi?.demandados || "").trim();
  if (!a && !b) return "—";
  return `${esc(a || "—")} <span style="color:${MUTED}">vs.</span> ${esc(b || "—")}`;
}

/**
 * LL1(b) — per-provider tallies. Actuaciones and estados are counted in
 * separate groups and labelled with their own provider names (HH2 intact).
 */
function providerTally(wi: WorkItemInfo | undefined): string {
  const c = wi?.providerCounts;
  if (!c) return "";
  const acts = Object.entries(c.acts)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${esc(actuacionSourceLabel(s))}: ${n}`);
  const ests = Object.entries(c.estados)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${esc(estadoSourceLabel(s))}: ${n}`);
  if (!acts.length && !ests.length) return "";
  return `
      <div style="font-size:11px;color:${MUTED};margin-top:4px;">
        ${acts.length ? `<span style="color:${ACT_ACCENT};">Actuaciones</span> — ${acts.join(" · ")}` : ""}
        ${acts.length && ests.length ? "<br/>" : ""}
        ${ests.length ? `<span style="color:${EST_ACCENT};">Estados</span> — ${ests.join(" · ")}` : ""}
        <br/><span style="font-style:italic;">Totales históricos registrados en Andromeda (filas vigentes), no del período.</span>
      </div>`;
}

function itemHeader(wi: WorkItemInfo | undefined, id: string, appBaseUrl: string): string {
  // YY2 — the court's observed behaviour, stated as observation and never as
  // a rule. Absent entirely while the evidence is insufficient.
  const behaviour = wi?.courtBehavior
    ? `<div style="font-size:12px;color:#a5b4fc;margin-top:4px;line-height:1.5;">
         Comportamiento observado del despacho: ${esc(wi.courtBehavior)}
       </div>`
    : "";
  return `
    <div style="padding:10px 12px;background:#16233f;border-bottom:1px solid ${BORDER};">
      <div style="font-size:14px;font-weight:700;color:#f8fafc;">${esc(wi?.title || "Asunto sin título")}</div>
      <div style="font-size:12px;color:${MUTED};margin-top:3px;">
        ${esc(wi?.radicado || "Sin radicado")} · ${esc(wi?.authority_name || "Despacho no registrado")}
      </div>
      <div style="font-size:12px;color:${MUTED};margin-top:2px;">${partes(wi)}</div>
      <div style="font-size:12px;color:${MUTED};margin-top:2px;">
        Clase de proceso: ${esc(wi?.clase_proceso || "No informada")}${wi?.workflow_type ? ` · ${esc(wi.workflow_type)}` : ""}
      </div>
      ${behaviour}
      ${providerTally(wi)}
      <a href="${appBaseUrl}/app/work-item/${esc(id)}" style="font-size:12px;color:${ACT_ACCENT};">Abrir en Andromeda →</a>
    </div>`;
}

function actuacionesTable(rows: ActuacionRow[], expiryDays: number): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
    <thead><tr>
      ${th("Fecha de actuación", ACT_ACCENT)}
      ${th("Detectado", ACT_ACCENT)}
      ${th("Actuación", ACT_ACCENT)}
      ${th("Anotación", ACT_ACCENT)}
      ${th("Fuente (actuación)", ACT_ACCENT)}
      ${th("Documento", ACT_ACCENT)}
    </tr></thead>
    <tbody>
      ${rows.map((r) => `<tr>
        ${td(fmtDate(r.act_date))}
        ${td(fmtDate(r.detected_at))}
        ${td(esc(r.description || r.act_type || "—"))}
        ${td(esc(r.annotation || "—"))}
        ${td(`<span style="color:${ACT_ACCENT};">${esc(actuacionSourceLabel(r.source))}</span>`)}
        ${td(docsCell(r.documents, expiryDays, r.document_availability))}
      </tr>`).join("")}
    </tbody>
  </table>`;
}

function estadosTable(rows: EstadoRow[], expiryDays: number): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
    <thead><tr>
      ${th("Fecha de fijación", EST_ACCENT)}
      ${th("Fecha de actuación", EST_ACCENT)}
      ${th("Detectado", EST_ACCENT)}
      ${th("Publicación", EST_ACCENT)}
      ${th("Observación", EST_ACCENT)}
      ${th("Fuente (estado)", EST_ACCENT)}
      ${th("Documento", EST_ACCENT)}
    </tr></thead>
    <tbody>
      ${rows.map((r) => `<tr>
        ${td(fmtDate(r.fecha_fijacion))}
        ${td(r.fecha_actuacion ? fmtDate(r.fecha_actuacion) : `<span style="color:${MUTED};">No informada</span>`)}
        ${td(fmtDate(r.detected_at))}
        ${td(esc(r.title || "—"))}
        ${td(esc(r.observacion || "—"))}
        ${td(`<span style="color:${EST_ACCENT};">${esc(estadoSourceLabel(r.source))}</span>`)}
        ${td(docsCell(r.documents, expiryDays, r.document_availability))}
      </tr>`).join("")}
    </tbody>
  </table>`;
}

function sectionTitle(text: string, accent: string, subtitle: string): string {
  return `
    <div style="margin:26px 0 10px;">
      <div style="font-size:15px;font-weight:700;color:${accent};">${esc(text)}</div>
      <div style="font-size:12px;color:${MUTED};margin-top:2px;">${esc(subtitle)}</div>
    </div>`;
}

/**
 * TT6 — ESTADO DE LAS FUENTES. Printed above the novedades, always when any
 * source is non-authoritative, so the reader never reaches the counts without
 * knowing what they are worth. Per-source coverage is stated as a fraction of
 * the expected portfolio; NOT_FOUND is shown separately because it is a
 * per-matter determination, not a source defect (TT8).
 */
function sourceQualityBlock(p: DigestPayload): string {
  const rows = p.sourceQuality ?? [];
  if (rows.length === 0) return "";
  const degraded = rows.filter((r) => !r.authoritative);

  const novedadesOf = (source: string) =>
    p.actuaciones.filter((a) => a.source === source).length +
    p.estados.filter((e) => e.source === source).length;

  // UU4(a) — the ratio is the message. A health word alone hides a chronic
  // 10/38: every source is listed with its coverage fraction and percentage,
  // degraded or not.
  const accent = degraded.length > 0 ? "#fbbf24" : "#94a3b8";
  const ratioOf = (r: typeof rows[number]) => {
    const den = r.expected_count || r.attempted_count || 0;
    if (!den) return "—";
    const pct = Math.round((r.usable_confirmed_count / den) * 100);
    return `${r.usable_confirmed_count}/${den} (${pct}%)`;
  };
  const outcomeBreakdown = (r: typeof rows[number]) => {
    const pending = r.pending_upstream_count ?? 0;
    const restricted = r.restricted_count ?? 0;
    const failures = r.error_count ?? 0;
    return [
      `${r.success_count} con datos`,
      `${r.success_empty_count} sin movimiento`,
      `${r.not_found_count} no encontrados`,
      `${restricted} privados`,
      `${pending} pendientes`,
      `${failures} fallidos`,
    ].join(" · ");
  };

  return sectionTitle(
    degraded.length > 0
      ? "Estado de las fuentes — cobertura incompleta"
      : "Estado de las fuentes — cobertura",
    accent,
    degraded.length > 0
      ? "Un cero en estas fuentes significa que no obtuvimos información autorizada, no que no haya novedades."
      : "Cobertura = asuntos con lectura confirmada sobre asuntos esperados en la ventana.",
  ) +
    `<table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;background:${CARD};">
      <thead><tr>${th("Fuente", accent)}${th("Cobertura útil", accent)}${th("Resultados", accent)}${th("Lectura del día", accent)}</tr></thead>
      <tbody>${rows.map((r) => `<tr>
        ${td(`<strong>${esc(r.label)}</strong>`)}
        ${td(`${ratioOf(r)} confirmadas`)}
        ${td(esc(outcomeBreakdown(r)))}
        ${td(esc(describeSourceQuality(r, novedadesOf(r.source))))}
      </tr>`).join("")}</tbody>
    </table>
    ${degraded.length > 0 ? `<div style="font-size:12px;color:${MUTED};margin-top:8px;line-height:1.6;">
      No se pausó el monitoreo de ningún asunto por esta degradación. La lectura se reintenta en la siguiente corrida.
    </div>` : ""}
    ${profileNote(rows)}`;
}

/**
 * YY1(e) — when a learned despacho profile removes matters from a source's
 * denominator, the mail says so, with the figure before and after. A profile
 * that shrinks the portfolio in silence would be indistinguishable from the
 * blindness it is meant to describe.
 */
function profileNote(rows: SourceQualityRow[]): string {
  const affected = rows.filter((r) => (r.excluded_by_profile ?? 0) > 0);
  if (!affected.length) return "";
  return `<div style="font-size:12px;color:${MUTED};margin-top:8px;line-height:1.6;">
    ${affected.map((r) =>
      `${esc(r.label)}: ${r.excluded_by_profile} asunto(s) excluidos del denominador ` +
      `(${r.expected_before_profile} → ${r.expected_count}) porque su despacho, según lo observado, ` +
      `no utiliza ese canal. Se sigue consultando y todo lo que publique se sigue guardando.`
    ).join("<br/>")}
  </div>`;
}


function novedadesBlock(p: DigestPayload): string {
  const ids = new Set<string>([
    ...p.actuaciones.map((a) => a.work_item_id),
    ...p.estados.map((e) => e.work_item_id),
  ]);
  if (ids.size === 0) return "";

  let out = sectionTitle(
    `Novedades (${p.actuaciones.length} actuaciones · ${p.estados.length} estados)`,
    "#f8fafc",
    "Actuaciones y estados son clases de evidencia distintas y se presentan por separado.",
  );

  for (const id of ids) {
    const acts = p.actuaciones.filter((a) => a.work_item_id === id);
    const ests = p.estados.filter((e) => e.work_item_id === id);
    out += `<div style="border:1px solid ${BORDER};border-radius:8px;overflow:hidden;margin-bottom:18px;background:${CARD};">
      ${itemHeader(p.workItems.get(id), id, p.appBaseUrl)}
      ${acts.length ? `<div style="padding:8px 12px 2px;font-size:12px;font-weight:700;color:${ACT_ACCENT};">ACTUACIONES — actos en el expediente (${acts.length})</div>${actuacionesTable(acts, p.linkExpiryDays)}` : ""}
      ${ests.length ? `<div style="padding:12px 12px 2px;font-size:12px;font-weight:700;color:${EST_ACCENT};">ESTADOS — publicaciones fijadas en lista (${ests.length})</div>${estadosTable(ests, p.linkExpiryDays)}` : ""}
    </div>`;
  }
  return out;
}

function hearingsBlock(rows: HearingRow[], p: DigestPayload): string {
  if (!rows.length) return "";
  return sectionTitle("Próximas audiencias (7 días)", "#fbbf24", "Agenda de la firma.") +
    `<table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;background:${CARD};">
      <thead><tr>${th("Fecha y hora", "#fbbf24")}${th("Asunto", "#fbbf24")}${th("Audiencia", "#fbbf24")}${th("Lugar / enlace", "#fbbf24")}</tr></thead>
      <tbody>${rows.map((h) => {
        const wi = p.workItems.get(h.work_item_id);
        return `<tr>
          ${td(fmtDateTime(h.scheduled_at))}
          ${td(`${esc(wi?.radicado || wi?.title || "—")}`)}
          ${td(esc(h.title || "Audiencia"))}
          ${td(h.is_virtual && h.virtual_link ? `<a href="${esc(h.virtual_link)}" style="color:${ACT_ACCENT};">Enlace virtual</a>` : esc(h.location || "—"))}
        </tr>`;
      }).join("")}</tbody>
    </table>`;
}

/**
 * NN1(b) / NN2(c)(d) — three lists, never one.
 *
 * "Sus términos" are the only obligations. Counterparty terms are tracked and
 * shown apart (an unopposed mandamiento advances, and he may want to exploit
 * that) but are never counted as his. Terms whose party is undetermined say so
 * instead of defaulting to him. Expired terms only survive here for the 3
 * business-day grace: after that they drain out of the mail entirely.
 */
function deadlinesBlock(rows: DeadlineRow[], p: DigestPayload): string {
  if (!rows.length) return "";
  const propios = rows.filter((d) => d.attribution === "PROPIO");
  const contraparte = rows.filter((d) => d.attribution === "CONTRAPARTE");
  const sinDeterminar = rows.filter(
    (d) => d.attribution !== "PROPIO" && d.attribution !== "CONTRAPARTE",
  );

  const table = (list: DeadlineRow[], accent: string, withParty = false) =>
    `<table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;background:${CARD};margin-bottom:14px;">
      <thead><tr>${th("Vence", accent)}${th("Asunto", accent)}${th("Término", accent)}${withParty ? th("A cargo de", accent) : ""}${th("Estado", accent)}</tr></thead>
      <tbody>${list.map((d) => {
        const wi = p.workItems.get(d.work_item_id);
        const party = BOUND_PARTY_SHORT[String(d.bound_party_role ?? "DESCONOCIDO")] ?? "parte no determinada";
        return `<tr>
          ${td(fmtDate(d.deadline_date))}
          ${td(esc(wi?.radicado || wi?.title || "—"))}
          ${td(esc(d.label || d.deadline_type || "—"))}
          ${withParty ? td(esc(party)) : ""}
          ${td(d.overdue
            ? `<span style="color:#f87171;font-weight:700;">Vencido hace ${Math.abs(d.days_left)} día(s)</span>`
            : `<span style="color:${accent};">Faltan ${d.days_left} día(s)</span>`)}
        </tr>`;
      }).join("")}</tbody>
    </table>`;

  const misVencidos = propios.filter((d) => d.overdue);
  const misPorVencer = propios.filter((d) => !d.overdue);

  const propioBlock = propios.length
    ? `<div style="font-size:12px;font-weight:700;color:#e2e8f0;margin-bottom:6px;">SUS TÉRMINOS (${propios.length})</div>` +
      (misVencidos.length
        ? `<div style="font-size:12px;font-weight:700;color:#f87171;margin-bottom:6px;">VENCIDOS — dentro de los 3 días hábiles de gracia (${misVencidos.length})</div>${table(misVencidos, "#f87171")}`
        : "") +
      (misPorVencer.length
        ? `<div style="font-size:12px;font-weight:700;color:#fb923c;margin-bottom:6px;">POR VENCER — próximos 7 días (${misPorVencer.length})</div>${table(misPorVencer, "#fb923c")}`
        : "")
    : "";

  const contraparteBlock = contraparte.length
    ? `<div style="font-size:12px;font-weight:700;color:#38bdf8;margin-bottom:6px;">TÉRMINOS DE LA CONTRAPARTE (${contraparte.length}) — seguimiento, no son obligaciones suyas</div>${table(contraparte, "#38bdf8", true)}`
    : "";

  const sinBlock = sinDeterminar.length
    ? `<div style="font-size:12px;font-weight:700;color:#94a3b8;margin-bottom:6px;">PARTE NO DETERMINADA (${sinDeterminar.length}) — confirme la calidad de su cliente en el expediente</div>${table(sinDeterminar, "#94a3b8", true)}`
    : "";

  return sectionTitle("Términos", "#f87171", "Cálculo de Andromeda sobre días hábiles colombianos.") +
    propioBlock + contraparteBlock + sinBlock;
}

/**
 * JJ1(c) — mailbox connection status, rendered FIRST. Losing the firm-side
 * evidence class is a headline condition, not a footnote.
 */
function connectionBlock(rows: ConnectionIssueRow[], appBaseUrl: string): string {
  if (!rows.length) return "";
  const critical = rows.some((r) => r.severity === "CRITICAL");
  const accent = critical ? "#f87171" : "#fbbf24";
  return `
  <div style="border:2px solid ${accent};border-radius:8px;background:#2a1216;padding:14px 16px;margin:18px 0 6px;">
    <div style="font-size:15px;font-weight:800;color:${accent};">
      ${critical ? "⚠ CORREO DE LA FIRMA — CONEXIÓN CAÍDA" : "CORREO DE LA FIRMA — ATENCIÓN"}
    </div>
    ${rows.map((r) => `
      <div style="margin-top:10px;">
        <div style="font-size:14px;font-weight:700;color:#f8fafc;">${esc(r.headline)}</div>
        <div style="font-size:13px;color:${TEXT};margin-top:3px;">${esc(r.detail)}</div>
        <div style="font-size:12px;color:${MUTED};margin-top:3px;">
          Buzón: ${esc(r.mailbox || "no registrado")} · Estado: ${esc(r.status)}${r.since ? ` · desde ${fmtDate(r.since)}` : ""}
        </div>
      </div>`).join("")}
    <div style="font-size:12px;color:${MUTED};margin-top:10px;">
      Mientras la conexión esté caída, la correspondencia del despacho no se vincula a los expedientes:
      la evidencia de lo que hizo <em>la firma</em> no se está capturando. Los proveedores judiciales siguen
      funcionando y lo reportado abajo no se ve afectado.
    </div>
    <a href="${appBaseUrl}/app/email" style="display:inline-block;margin-top:10px;font-size:13px;font-weight:700;color:${accent};">Reconectar el buzón →</a>
  </div>`;
}

/**
 * OO1 — matters hidden from this digest. They ARE still being read (unless
 * their lifecycle stopped ingestion); the section says so plainly.
 */
/**
 * YY3 — RECONCILIACIÓN. A finding recovered after a collection defect, shown
 * exactly once. It is not a novedad and it derives nothing: no term, no alert.
 */
function reconciliationBlock(rows: ReconciliationNoticeRow[], p: DigestPayload): string {
  if (!rows.length) return "";
  return sectionTitle(
    `Reconciliación — hallazgos recuperados (${rows.length})`,
    "#a78bfa",
    "Información que ya existía en el despacho y que no habíamos leído por una falla de recolección, ya corregida. No son novedades del día y no generan términos por sí solas.",
  ) +
  rows.map((r) => {
    const wi = r.work_item_id ? p.workItems.get(r.work_item_id) : undefined;
    const span = r.from_date && r.to_date ? `${fmtDate(r.from_date)} a ${fmtDate(r.to_date)}` : "Periodo no registrado";
    return `<div style="border:1px solid ${BORDER};border-radius:8px;background:${CARD};padding:12px;margin-bottom:12px;">
      <div style="font-size:14px;font-weight:700;color:#f8fafc;">${esc(r.headline)}</div>
      <div style="font-size:12px;color:${MUTED};margin-top:3px;">
        ${esc(wi?.radicado || "Sin radicado")}${wi?.title ? ` · ${esc(wi.title)}` : ""}
      </div>
      <div style="font-size:13px;color:${TEXT};margin-top:6px;line-height:1.6;">
        ${r.rows_count} registro(s) · ${esc(span)}
      </div>
      <div style="font-size:12px;color:${MUTED};margin-top:6px;line-height:1.6;">${esc(r.detail)}</div>
      ${r.work_item_id
        ? `<a href="${p.appBaseUrl}/app/work-item/${esc(r.work_item_id)}" style="font-size:12px;color:#a78bfa;">Revisar el expediente →</a>`
        : ""}
    </div>`;
  }).join("");
}

/**
 * D3 — «historial importado». One line per matter: what arrived, and the span
 * it covers. Never mixed with the novedad count, and never presented as news.
 */
function importedHistoryBlock(p: DigestPayload): string {
  const rows = p.importedHistory ?? [];
  if (!rows.length) return "";
  return sectionTitle(
    `Historial importado — no son novedades (${rows.length} asunto(s))`,
    "#60a5fa",
    "Estas filas llegaron hoy porque el proveedor entregó por primera vez la historia del expediente (lectura inicial o reactivación). Son actos pasados: no se cuentan como novedades del día.",
  ) +
  `<table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;background:${CARD};">
    <thead><tr>${th("Radicado", "#60a5fa")}${th("Asunto", "#60a5fa")}${th("Filas importadas", "#60a5fa")}${th("Periodo cubierto", "#60a5fa")}</tr></thead>
    <tbody>${rows.map((r) => {
      const wi = p.workItems.get(r.work_item_id);
      const parts: string[] = [];
      if (r.acts) parts.push(`${r.acts} actuación(es)`);
      if (r.estados) parts.push(`${r.estados} estado(s)`);
      const span = r.from_year && r.to_year
        ? (r.from_year === r.to_year ? String(r.from_year) : `${r.from_year} a ${r.to_year}`)
        : "Sin fecha registrada";
      return `<tr>
        ${td(`<a href="${p.appBaseUrl}/app/work-item/${esc(r.work_item_id)}" style="color:#60a5fa;">${esc(wi?.radicado || "Sin radicado")}</a>`)}
        ${td(esc(wi?.title || "—"))}
        ${td(esc(parts.join(" + ") || String(r.rows)))}
        ${td(esc(span))}
      </tr>`;
    }).join("")}</tbody>
  </table>`;
}

function suspendedBlock(rows: SuspendedItemRow[], appBaseUrl: string): string {
  if (!rows.length) return "";
  const anyStopped = rows.some((r) => !r.reading_active);
  return sectionTitle(
    `Monitoreo oculto — no aparecen en este resumen (${rows.length})`,
    "#fbbf24",
    "Estos asuntos se siguen consultando con sus proveedores y todo lo que publiquen se sigue guardando: no se está perdiendo nada. Lo único que ocurre es que sus novedades no se muestran en este resumen.",
  ) +
  `<table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;background:${CARD};">
    <thead><tr>${th("Radicado", "#fbbf24")}${th("Asunto", "#fbbf24")}${th("Tipo", "#fbbf24")}${th("Oculto desde", "#fbbf24")}${th("Motivo registrado", "#fbbf24")}${th("Lectura del proveedor", "#fbbf24")}${th("Movimiento desde entonces", "#fbbf24")}</tr></thead>
    <tbody>${rows.map((r) => {
      const total = r.acts_since + r.estados_since;
      const parts: string[] = [];
      if (r.acts_since) parts.push(`${r.acts_since} actuación(es)`);
      if (r.estados_since) parts.push(`${r.estados_since} estado(s)`);
      const movement = total
        ? `<span style="color:#fbbf24;font-weight:700;">${parts.join(" + ")}</span>${r.last_movement_at ? ` · última ${fmtDate(r.last_movement_at)}` : ""}`
        : `<span style="color:${MUTED};">Sin movimiento registrado</span>`;
      const reading = r.reading_active
        ? `<span style="color:#34d399;">Sí — se sigue leyendo y guardando</span>`
        : `<span style="color:#f87171;font-weight:700;">No — lectura detenida</span><div style="font-size:11px;color:#f87171;">Se está acumulando un vacío: lo que el despacho publique mientras tanto no se está capturando.</div>`;
      return `<tr>
      ${td(`<a href="${appBaseUrl}/app/work-item/${esc(r.id)}" style="color:#fbbf24;">${esc(r.radicado || "Sin radicado")}</a>`)}
      ${td(esc(r.title || "—"))}
      ${td(esc(r.workflow_type || "—"))}
      ${td(fmtDate(r.suspended_at))}
      ${td(esc(r.reason || "No registrado"))}
      ${td(reading)}
      ${td(movement)}
    </tr>`;
    }).join("")}</tbody>
  </table>
  <div style="font-size:12px;color:${MUTED};margin-top:6px;">El movimiento se cuenta desde la fecha en que el asunto se ocultó y no se detalla aquí: ábralo para verlo. Volver a mostrarlos en el resumen es una decisión suya; Andromeda no los reactiva por su cuenta.${anyStopped ? " Las filas marcadas «lectura detenida» sí tienen un vacío real: en esas la consulta al proveedor está apagada." : ""}</div>`;
}


/** JJ3(b) — non-judicial matters live in their own section, on their own terms. */
function nonJudicialBlock(rows: DeadlineRow[], p: DigestPayload): string {
  if (!p.nonJudicialCount) return "";
  const body = rows.length
    ? `<table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;background:${CARD};">
        <thead><tr>${th("Vence", "#34d399")}${th("Asunto", "#34d399")}${th("Término", "#34d399")}${th("Estado", "#34d399")}</tr></thead>
        <tbody>${rows.map((d) => {
          const wi = p.workItems.get(d.work_item_id);
          return `<tr>
            ${td(fmtDate(d.deadline_date))}
            ${td(esc(wi?.title || wi?.radicado || "—"))}
            ${td(esc(d.label || d.deadline_type || "—"))}
            ${td(d.overdue
              ? `<span style="color:#f87171;font-weight:700;">Vencido hace ${Math.abs(d.days_left)} día(s)</span>`
              : `<span style="color:#34d399;">Faltan ${d.days_left} día(s)</span>`)}
          </tr>`;
        }).join("")}</tbody>
      </table>`
    : `<div style="font-size:13px;color:${MUTED};">Sin términos por vencer en los próximos 7 días.</div>`;

  return sectionTitle(
    `Peticiones y actuaciones administrativas (${p.nonJudicialCount})`,
    "#34d399",
    "No son procesos judiciales: no tienen radicado en la Rama Judicial y ningún proveedor los consulta. Sus términos son propios (Ley 1755 y normas administrativas).",
  ) + body;
}

export function buildDigestHtml(p: DigestPayload): string {
  const total = p.actuaciones.length + p.estados.length;
  const greeting = p.recipientName ? `Buenos días, ${esc(p.recipientName)}.` : "Buenos días.";

  // TT6 — the headline count is only a statement about what we READ. When a
  // source failed to cover the portfolio the sentence must say so in the same
  // breath, never afterwards and never in small print.
  const headline = p.coverageIncomplete
    ? `${greeting} ${total} novedad(es) detectadas entre ${fmtDateTime(p.windowFrom)} y ${fmtDateTime(p.windowTo)} ` +
      `sobre una <strong style="color:#fbbf24;">cobertura incompleta de fuentes</strong>: ` +
      `esta cifra no permite concluir que no haya movimiento.`
    : `${greeting} ${total} novedad(es) detectadas entre ${fmtDateTime(p.windowFrom)} y ${fmtDateTime(p.windowTo)}.`;

  return `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:${BG};">
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:920px;margin:0 auto;padding:24px;background:${BG};color:${TEXT};">
    <div style="font-size:20px;font-weight:800;color:#f8fafc;">Andromeda — Resumen diario</div>
    <div style="font-size:13px;color:${MUTED};margin-top:4px;">
      ${headline}
    </div>

    ${connectionBlock(p.connectionIssues, p.appBaseUrl)}
    ${sourceQualityBlock(p)}
    ${novedadesBlock(p)}
    ${reconciliationBlock(p.reconciliations ?? [], p)}
    ${importedHistoryBlock(p)}
    ${hearingsBlock(p.hearings, p)}
    ${deadlinesBlock(p.deadlines, p)}
    ${nonJudicialBlock(p.nonJudicialDeadlines, p)}
    ${suspendedBlock(p.suspended, p.appBaseUrl)}

    <div style="margin-top:28px;padding-top:14px;border-top:1px solid ${BORDER};font-size:12px;color:${MUTED};line-height:1.6;">
      <div><strong style="color:${TEXT};">${p.monitoredCount}</strong> asuntos judiciales en monitoreo activo con proveedores.
      ${p.nonJudicialCount > 0
        ? `<strong style="color:${TEXT};">${p.nonJudicialCount}</strong> asuntos no judiciales (peticiones / actuaciones administrativas), que no se consultan con ningún proveedor.`
        : "Sin asuntos no judiciales activos."}
      Las dos cifras no se suman: son universos distintos.</div>
      <div>Los asuntos eliminados, pausados o archivados no se incluyen ni se cuentan.</div>
      ${p.suspended.length > 0 ? `<div>${p.suspended.length} asunto(s) con monitoreo suspendido — ver la sección correspondiente.</div>` : ""}
      ${p.silentCount > 0 ? `<div>${p.silentCount} asunto(s) sin lectura exitosa del proveedor en más de 72 horas.</div>` : ""}
      <div style="margin-top:8px;">
        <strong style="color:${TEXT};">Nota sobre fechas.</strong> La <em>fecha de actuación</em> es la fecha del acto en el
        expediente. La <em>fecha de fijación</em> es la fecha en que el estado fue publicado en lista. No son equivalentes
        y los términos corren desde la que la norma indique en cada caso.
      </div>
      <div style="margin-top:8px;">
        Este resumen refleja únicamente lo que los proveedores judiciales reportan sobre la actuación del despacho.
        La correspondencia de la firma no se presenta aquí como acto judicial.
      </div>
      <div style="margin-top:8px;">Andromeda · andromeda.legal</div>
    </div>
  </div></body></html>`;
}
