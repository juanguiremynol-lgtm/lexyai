/**
 * html.ts — renderer for the consolidated daily digest.
 *
 * HH2(a): ACTUACIONES and ESTADOS get their own table, their own header, their
 * own colour and their own column set. They are never merged into one list and
 * never rendered identically.
 * HH2(d): both dates are shown and labelled — "fecha de actuación" (the act's
 * date in the expediente) and "fecha de fijación" (when the estado was posted).
 * HH3(c): a row with no document says "sin documento adjunto"; it is not hidden.
 */

import {
  actuacionSourceLabel,
  estadoSourceLabel,
  type ActuacionRow,
  type DeadlineRow,
  type DigestDocument,
  type DigestPayload,
  type EstadoRow,
  type HearingRow,
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

function docsCell(docs: DigestDocument[], expiryDays: number): string {
  if (!docs.length) {
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

function itemHeader(wi: WorkItemInfo | undefined, id: string, appBaseUrl: string): string {
  return `
    <div style="padding:10px 12px;background:#16233f;border-bottom:1px solid ${BORDER};">
      <div style="font-size:14px;font-weight:700;color:#f8fafc;">${esc(wi?.title || "Asunto sin título")}</div>
      <div style="font-size:12px;color:${MUTED};margin-top:3px;">
        ${esc(wi?.radicado || "Sin radicado")} · ${esc(wi?.authority_name || "Despacho no registrado")}
      </div>
      <div style="font-size:12px;color:${MUTED};margin-top:2px;">${partes(wi)}</div>
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
        ${td(docsCell(r.documents, expiryDays))}
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
        ${td(docsCell(r.documents, expiryDays))}
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

function deadlinesBlock(rows: DeadlineRow[], p: DigestPayload): string {
  if (!rows.length) return "";
  const vencidos = rows.filter((d) => d.overdue);
  const porVencer = rows.filter((d) => !d.overdue);

  const table = (list: DeadlineRow[], accent: string) =>
    `<table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;background:${CARD};margin-bottom:14px;">
      <thead><tr>${th("Vence", accent)}${th("Asunto", accent)}${th("Término", accent)}${th("Estado", accent)}</tr></thead>
      <tbody>${list.map((d) => {
        const wi = p.workItems.get(d.work_item_id);
        return `<tr>
          ${td(fmtDate(d.deadline_date))}
          ${td(esc(wi?.radicado || wi?.title || "—"))}
          ${td(esc(d.label || d.deadline_type || "—"))}
          ${td(d.overdue
            ? `<span style="color:#f87171;font-weight:700;">Vencido hace ${Math.abs(d.days_left)} día(s)</span>`
            : `<span style="color:${accent};">Faltan ${d.days_left} día(s)</span>`)}
        </tr>`;
      }).join("")}</tbody>
    </table>`;

  return sectionTitle("Términos", "#f87171", "Cálculo de Andromeda sobre días hábiles colombianos.") +
    (vencidos.length ? `<div style="font-size:12px;font-weight:700;color:#f87171;margin-bottom:6px;">VENCIDOS (${vencidos.length})</div>${table(vencidos, "#f87171")}` : "") +
    (porVencer.length ? `<div style="font-size:12px;font-weight:700;color:#fb923c;margin-bottom:6px;">POR VENCER — próximos 7 días (${porVencer.length})</div>${table(porVencer, "#fb923c")}` : "");
}

export function buildDigestHtml(p: DigestPayload): string {
  const total = p.actuaciones.length + p.estados.length;
  const greeting = p.recipientName ? `Buenos días, ${esc(p.recipientName)}.` : "Buenos días.";

  return `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:${BG};">
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:920px;margin:0 auto;padding:24px;background:${BG};color:${TEXT};">
    <div style="font-size:20px;font-weight:800;color:#f8fafc;">Andromeda — Resumen diario</div>
    <div style="font-size:13px;color:${MUTED};margin-top:4px;">
      ${greeting} ${total} novedad(es) detectadas entre ${fmtDateTime(p.windowFrom)} y ${fmtDateTime(p.windowTo)}.
    </div>

    ${novedadesBlock(p)}
    ${hearingsBlock(p.hearings, p)}
    ${deadlinesBlock(p.deadlines, p)}

    <div style="margin-top:28px;padding-top:14px;border-top:1px solid ${BORDER};font-size:12px;color:${MUTED};line-height:1.6;">
      <div><strong style="color:${TEXT};">${p.monitoredCount}</strong> asuntos en monitoreo activo en Andromeda al momento de generar este resumen.
      Los asuntos eliminados, pausados o archivados no se incluyen ni se cuentan.</div>
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
