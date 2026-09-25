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
import { reservaNoticeShort } from "../_shared/reservaNotice.ts";

import {
  BOUND_PARTY_SHORT,
  actuacionSourceLabel,
  LEGACY_ACT_SOURCES,
  estadoSourceLabel,
  ESTADO_SOURCE_LABELS,
  ACTUACION_SOURCE_LABELS,
  type ActuacionRow,
  type ConnectionIssueRow,
  type DocumentAvailability,
  type DeadlineRow,
  type DigestDocument,
  type DigestPayload,
  type EstadoRow,
  type HearingRow,
  type NeverReadRow,
  type PrecedingActRow,
  type ProvidenciaCrossRef,
  type ReconciliationNoticeRow,
  type SourceQualityRow,
  type AutoPausedItemRow,
  type WorkItemInfo,
} from "./types.ts";

const BG = "#0f172a";
const CARD = "#111c34";
const BORDER = "#334155";
const TEXT = "#e2e8f0";
const MUTED = "#94a3b8";
const ACT_ACCENT = "#38bdf8"; // actuación
const EST_ACCENT = "#a78bfa"; // estado
const WARN_ACCENT = "#f59e0b"; // vínculo no confirmado (AB1)

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
    // IW1 — the planilla was announced by the provider without the file.
    // It must not read as if we hold a PDF, nor as if nothing was published.
    // LS4(b) — the provider served it and no longer keeps it. The publication
    // and its date stand; the copy is requested from the despacho.
    if (availability === "RETENCION_VENCIDA_EN_ORIGEN") {
      return `<span style="color:${MUTED};font-style:italic;">El proveedor ya no conserva la copia — la publicación y su fecha siguen registradas; el documento se solicita al despacho</span>`;
    }
    if (availability === "CONSTANCIA_SIN_DOCUMENTO") {
      return `<span style="color:${MUTED};font-style:italic;">Constancia de fijación sin documento adjunto — el proveedor informa la publicación en el estado y no entrega el listado</span>`;
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
  // IW3(c) — the per-channel breakdown lists LIVE providers only. Retired
  // sources (icarus_import) are still counted in the matter's total and their
  // provenance stays on the row; they are not a channel in the daily mail.
  const acts = Object.entries(c.acts)
    .filter(([s]) => !LEGACY_ACT_SOURCES.has(s))
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
      <a href="${appBaseUrl}/app/work-items/${esc(id)}" style="font-size:12px;color:${ACT_ACCENT};">Abrir en Andromeda →</a>
    </div>`;
}

/**
 * ZZ1(d)(e) — the two channels agreeing is itself evidence, so it is stated
 * explicitly, with BOTH dates: the act's date in the expediente and the date
 * the estado was fixed on the list. Neither date is ever substituted for the
 * other, and the confidence of the link is disclosed.
 */
function crossRefNote(
  ref: ProvidenciaCrossRef | null | undefined,
  side: "ACT" | "EST",
): string {
  if (!ref) return "";
  const alta = ref.confidence === "ALTA";
  const colour = alta ? (side === "ACT" ? EST_ACCENT : ACT_ACCENT) : WARN_ACCENT;
  const counterpartDate = side === "ACT"
    ? fmtDate(ref.fecha_fijacion)
    : fmtDate(ref.act_date);

  // AB1(b) — a MEDIA link never speaks with the voice of an ALTA link. It is
  // announced as a possibility, it names what it rests on, and it carries no
  // borrowed document.
  if (!alta) {
    return `<div style="font-size:11px;color:${colour};margin-top:4px;line-height:1.5;">
      ⚠ ${esc(side === "ACT"
        ? `Posible correspondencia con un estado del ${counterpartDate}.`
        : `Posible correspondencia con una actuación del ${counterpartDate}.`)}
      <b>Vínculo no confirmado:</b> ${esc(ref.match_basis)}.
      <span style="color:${MUTED};">Ese día puede haber más de una providencia; verifíquelo antes de confiar en la equivalencia. No se enlaza aquí el documento de la otra fuente.</span>
    </div>`;
  }

  const head = side === "ACT"
    ? `Misma providencia, publicada en estado el ${counterpartDate}.`
    : `Misma providencia, registrada como actuación el ${counterpartDate}.`;
  const borrowed = ref.documents_borrowed
    ? " El PDF que se enlaza aquí es el del estado: en la actuación el proveedor no adjuntó archivo."
    : "";
  return `<div style="font-size:11px;color:${colour};margin-top:4px;line-height:1.5;">
      ↔ ${esc(head)}${esc(borrowed)}
      <span style="color:${MUTED};"> (coincidencia alta — ${esc(ref.match_basis)}; se muestran ambas fechas y no se fusionan los registros)</span>
    </div>`;
}

/**
 * AD1(a) — «Últimas actuaciones»: las 2-3 anteriores, con su anotación.
 * Es CONTEXTO, no novedad: se dice así en el propio bloque, no lleva documento
 * y no entra en ninguna cifra del correo.
 */
function precedingActs(rows: PrecedingActRow[] | undefined): string {
  if (!rows || !rows.length) return "";
  return `<div style="margin-top:6px;padding:6px 8px;border-left:2px solid ${BORDER};background:rgba(148,163,184,0.06);">
    <div style="font-size:10px;letter-spacing:.04em;color:${MUTED};text-transform:uppercase;">Últimas actuaciones anteriores (contexto, no son novedad)</div>
    ${rows.map((r) => `<div style="font-size:11px;color:${TEXT};margin-top:3px;line-height:1.45;">
        <span style="color:${MUTED};">${fmtDate(r.act_date)}</span> — ${esc(r.description || "—")}
        ${r.annotation ? `<span style="color:${MUTED};"> · ${esc(r.annotation)}</span>` : ""}
      </div>`).join("")}
  </div>`;
}

/**
 * JN1 — jerarquía de lectura, no de estado. Una decisión de fondo y un
 * memorial no pueden compartir tipografía. Esto es PRESENTACIÓN: no crea
 * alerta, ni sección, ni conteo, ni término.
 */
const DECISION_VOCAB: string[] = [
  "sentencia",
  "auto decide",
  "auto resuelve recurso de queja",
  "auto resuelve recurso",
  "resuelve recurso de queja",
  "decide apelacion",
  "decide apelación",
  "auto admisorio",
  "auto inadmite",
  "auto rechaza",
  "mandamiento de pago",
  "auto que ordena seguir adelante",
  "seguir adelante la ejecucion",
  "seguir adelante la ejecución",
  "auto aprueba liquidacion",
  "auto aprueba liquidación",
  "auto termina proceso",
  "auto declara terminado",
  "resuelve excepciones",
  "auto decreta",
];

function normalizeForVocab(v: string): string {
  return v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isDecisionAct(r: ActuacionRow): boolean {
  const hay = normalizeForVocab(`${r.description ?? ""} ${r.act_type ?? ""} ${r.annotation ?? ""}`);
  return DECISION_VOCAB.some((t) => hay.includes(normalizeForVocab(t)));
}

const DECISION_PILL = `<span style="display:inline-block;border:1px solid ${TEXT};border-radius:3px;padding:0 5px;margin-right:6px;font-size:9px;font-weight:700;letter-spacing:.08em;color:${TEXT};vertical-align:middle;">DECISIÓN</span>`;

function actuacionesTable(rows: ActuacionRow[], expiryDays: number): string {
  // Orden de lectura: las decisiones primero, conservando el orden relativo.
  const ordered = [...rows].sort((a, b) => Number(isDecisionAct(b)) - Number(isDecisionAct(a)));
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
      ${ordered.map((r) => {
        const dec = isDecisionAct(r);
        return `<tr>
        ${td(fmtDate(r.act_date))}
        ${td(fmtDate(r.detected_at))}
        ${td((dec ? DECISION_PILL : "") + `<span style="${dec ? `color:${TEXT};font-weight:700;` : ""}">${esc(r.description || r.act_type || "—")}</span>` + crossRefNote(r.crossRef, "ACT") + precedingActs(r.precedingActs))}
        ${td(esc(r.annotation || "—"))}
        ${td(`<span style="color:${ACT_ACCENT};">${esc(actuacionSourceLabel(r.source))}</span>`)}
        ${td(docsCell(r.documents, expiryDays, r.document_availability))}
      </tr>`;
      }).join("")}
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
        ${td(r.fecha_fijacion ? fmtDate(r.fecha_fijacion) : `<span style="color:${MUTED};">La fuente no informó fecha de fijación — no corre término</span>`)}
        ${td(r.fecha_actuacion ? fmtDate(r.fecha_actuacion) : `<span style="color:${MUTED};">No informada</span>`)}
        ${td(fmtDate(r.detected_at))}
        ${td(esc(r.title || "—") + crossRefNote(r.crossRef, "EST") + precedingActs(r.precedingActs))}
        ${td(esc(r.observacion || "—"))}
        ${td(`<span style="color:${EST_ACCENT};">${esc(estadoSourceLabel(r.source))}</span>`)}
        ${td(docsCell(r.documents, expiryDays, r.document_availability))}
      </tr>`).join("")}
    </tbody>
  </table>`;
}

/**
 * AD1(b) — LA TIRA DE CINCO CIFRAS. Se lee en dos segundos y va SIEMPRE
 * seguida de la tabla de fuentes: la tira da velocidad, la tabla da verdad.
 * Ninguna cifra de la tira puede leerse como "no hubo movimiento".
 */
function statStripBlock(p: DigestPayload): string {
  const s = p.stats;
  if (!s) return "";
  const cell = (n: number, label: string, accent: string) => `
    <td style="padding:10px 8px;text-align:center;border-right:1px solid ${BORDER};">
      <div style="font-size:20px;font-weight:800;color:${accent};">${n}</div>
      <div style="font-size:10px;color:${MUTED};text-transform:uppercase;letter-spacing:.04em;">${esc(label)}</div>
    </td>`;
  return `
  <table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;background:${CARD};margin-top:16px;">
    <tr>
      ${cell(s.procesosConNovedad, "procesos con novedad", "#f8fafc")}
      ${cell(s.publicaciones, "estados (PP)", EST_ACCENT)}
      ${cell(s.cpnu, "actuaciones (CPNU)", ACT_ACCENT)}
      ${cell(s.samai, "SAMAI", "#34d399")}
      ${cell(s.erroresFuente, "errores de fuente", s.erroresFuente > 0 ? WARN_ACCENT : MUTED)}
    </tr>
  </table>
  <div style="font-size:11px;color:${MUTED};margin-top:6px;">
    Cifras de lo ingerido en la ventana. Lo que valen esas cifras lo dice la tabla de fuentes que sigue.
  </div>`;
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
  // LW1 — the denominator is the source's own chain. A matter the source was
  // correctly never asked about (routing skip) is not in the numerator, not in
  // the denominator, and never appears as "sin confirmar".
  // LW2 — a "proceso privado" answer counts as an answered read: the source
  // reached the matter. What it refused is reported on its own line.
  const ratioOf = (r: typeof rows[number]) => {
    const den = r.expected_count || 0;
    if (!den) return "—";
    const answered = r.answered_count ?? r.usable_confirmed_count;
    const pct = Math.round((answered / den) * 100);
    return `${answered}/${den} (${pct}%)`;
  };
  const verdictOf = (r: typeof rows[number]) => {
    if (r.check_failed) {
      return `<span style="color:#fbbf24;font-weight:700;">No pudimos verificar esta fuente hoy${
        r.check_failed_reason ? ` (${r.check_failed_reason})` : ""
      }. No afirmamos que no haya novedades.</span>`;
    }
    const den = r.expected_count || 0;
    const answered = r.answered_count ?? r.usable_confirmed_count;

    if (den > 0 && answered >= den) {
      return `<span style="color:#4ade80;font-weight:700;">Lectura completa de su cadena</span>`;
    }
    const never = Number((r as unknown as Record<string, unknown>).never_delivered_count ?? 0);
    const faltan = Math.max(den - answered - never, 0);
    const parts = [
      never ? `${never} nunca han entregado desde su alta` : "",
      faltan ? `${faltan} asunto(s) sin respuesta` : "",
    ].filter(Boolean).join(" · ");
    return `<span style="color:#fbbf24;font-weight:700;">Lectura parcial — ${parts}</span>`;
  };
  // LW3/LW4 — one line per matter, never a bare count.
  const exceptionsOf = (source: string, kind: string) =>
    (p.coverageExceptions ?? []).filter((e) => e.source === source && e.kind === kind);
  const matterList = (source: string, kind: string, title: string, color: string) => {
    const list = exceptionsOf(source, kind);
    if (!list.length) return "";
    return `<div style="margin-top:6px;font-size:11px;color:${color};">${title}</div>` +
      `<ul style="margin:2px 0 0 16px;padding:0;font-size:11px;color:#cbd5e1;">` +
      list.map((e) =>
        `<li>${esc(e.radicado || "sin radicado")} — ${esc(e.title || "—")}</li>`,
      ).join("") + `</ul>`;
  };
  // JC2 — the two zeros are different facts and are never merged. Only an
  // ANSWERED empty read is "sin movimiento"; a refusal is "privados"; a fast
  // failure (p. ej. respuesta no interpretable en 163 ms) es "fallidos" y no
  // afirma nada sobre el expediente.
  const outcomeBreakdown = (r: typeof rows[number]) => {
    const pending = r.pending_upstream_count ?? 0;
    const restricted = r.restricted_count ?? 0;
    const failures = r.error_count ?? 0;
    return [
      `${r.success_count} con datos`,
      `${r.success_empty_count} leídos sin movimiento`,
      ...(Number((r as unknown as Record<string, unknown>).never_delivered_count ?? 0)
        ? [`${(r as unknown as Record<string, unknown>).never_delivered_count} nunca han entregado desde su alta (ver «Fuentes que llevan días sin entregar»)`]
        : []),
      `${r.not_found_count} no encontrados`,
      `${restricted} asunto(s) marcados «proceso privado» por el proveedor (afirmación suya, sin comprobar)`,
      `${pending} asunto(s) pendientes en la fuente`,
      `${failures} sin lectura (falla, no significa "sin novedades")`,
    ].join(" · ");
  };


  // LW2 — the verdict is per source. «CPNU leyó completo» y «Publicaciones leyó
  // parcial» son hechos distintos del mismo día y no se resumen en una palabra.
  return sectionTitle(
    "Estado de las fuentes — cobertura por fuente",
    accent,
    "Cada fuente se mide contra su propia cadena de asuntos. Lo que una fuente no debe leer " +
      "(p. ej. Publicaciones frente a un asunto CPACA) no se cuenta como lectura faltante.",
  ) +
    `<table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;background:${CARD};">
      <thead><tr>${th("Fuente", accent)}${th("Cobertura de su cadena", accent)}${th("Resultados", accent)}${th("Lectura del día", accent)}</tr></thead>
      <tbody>${rows.map((r) => `<tr>
        ${td(`<strong>${esc(r.label)}</strong>` +
          (r.routing_skipped_count
            ? `<br><span style="color:#94a3b8;font-size:11px;">${r.routing_skipped_count} asunto(s) fuera de su cadena: no se le consultan y no cuentan.</span>`
            : ""))}
        ${td(`${ratioOf(r)} respondidas<br>${verdictOf(r)}` +
          // LX — los pendientes crónicos viven en su propia sección, con su
          // antigüedad; repetirlos aquí sin edad los vuelve ruido.
          matterList(r.source, "READ_FAILED", "Sin lectura por falla:", "#f87171") +
          matterList(r.source, "RESTRICTED", "El proveedor los marcó «proceso privado» (afirmación suya, sin comprobar):", "#94a3b8"))}
        ${td(esc(outcomeBreakdown(r)))}
        ${td(esc(describeSourceQuality(r, novedadesOf(r.source))))}
      </tr>`).join("")}</tbody>
    </table>
    <div style="font-size:12px;color:${MUTED};margin-top:8px;line-height:1.6;">
      <strong style="color:${TEXT};">Cómo leer estas cifras.</strong> La cobertura se mide sobre las lecturas de las
      últimas 24 horas (${fmtDateTime(p.coverageWindowFrom)} → ${fmtDateTime(p.coverageWindowTo)}), mientras que las
      novedades se cuentan sobre el día calendario del resumen (${fmtDateTime(p.windowFrom)} → ${fmtDateTime(p.windowTo)}).
      ${fmtDateTime(p.coverageWindowFrom) !== fmtDateTime(p.windowFrom) || fmtDateTime(p.coverageWindowTo) !== fmtDateTime(p.windowTo)
        ? `Son ventanas distintas: por eso una fuente puede mostrar «0 con datos» y aun así aparecer una novedad detectada
      en el resumen, o al revés. `
        : ""}Una lectura que guardó registros se cuenta siempre como «con datos».
    </div>
    ${degraded.length > 0 ? `<div style="font-size:12px;color:${MUTED};margin-top:8px;line-height:1.6;">
      No se pausó el monitoreo de ningún asunto por esta degradación. La lectura se reintenta en la siguiente corrida.
    </div>` : ""}
    ${profileNote(rows)}`;
}

/**
 * LX — "Fuentes que llevan N días sin entregar".
 *
 * The same sixteen matters have been pending for weeks. Repeating "cobertura
 * incompleta" every morning over a population that never changes teaches the
 * reader to skip the line. So the standing population lives here, named, with
 * the number of consecutive days behind each one — that number is what tells
 * him whether to open the portal himself — and the headline above reports only
 * what moved today.
 */
function persistenceBlock(p: DigestPayload): string {
  const rows = p.coveragePersistence ?? [];
  if (!rows.length) return "";
  const label = (s: string) =>
    ESTADO_SOURCE_LABELS[s] ?? ACTUACION_SOURCE_LABELS[s] ?? s;
  const chronic = rows.filter((r) => r.status !== "RECOVERED_TODAY")
    .sort((a, b) => b.consecutive_days - a.consecutive_days);
  const recovered = rows.filter((r) => r.status === "RECOVERED_TODAY");
  const accent = "#fbbf24";
  const ageCell = (d: number, since: string | null) =>
    `<strong style="color:${d >= 7 ? "#f87171" : accent};">${d} día(s)</strong>` +
    (since ? `<br><span style="color:#94a3b8;font-size:11px;">desde ${esc(since)}</span>` : "");
  const kindText = (k: string | null) =>
    k === "READ_FAILED"
      ? "la lectura falló"
      : k === "PENDING_UPSTREAM"
      ? "la fuente responde que la consulta sigue pendiente de su lado"
      : "la fuente contesta, pero sin ninguna publicación";
  // LY — dos hechos distintos que la tabla llamaba igual.
  const classCell = (r: typeof rows[number]) => {
    if (r.gap_class === "EN_VERIFICACION") {
      const dias = r.days_since_enrolment ?? r.consecutive_days;
      return `<strong style="color:${accent};">EN VERIFICACIÓN</strong><br>` +
        `<span style="color:#cbd5e1;font-size:11px;">Asunto nuevo` +
        (r.enrolled_at ? ` (alta ${esc(r.enrolled_at)}, hace ${dias} día(s))` : "") +
        `; un asunto recién inscrito normalmente aún no tiene registros</span>`;
    }
    if (r.gap_class === "NEVER_ANSWERED") {
      const dias = r.days_since_enrolment ?? r.consecutive_days;
      const other = (r as unknown as Record<string, unknown>).other_channel_delivers as string | undefined;
      return `<strong style="color:#f87171;">NUNCA HA RESPONDIDO</strong><br>` +
        `<span style="color:#cbd5e1;font-size:11px;">Ni una publicación desde el alta` +
        (r.enrolled_at ? ` (${esc(r.enrolled_at)}, hace ${dias} día(s))` : "") +
        (r.attempts_total ? ` · ${r.attempts_total} consulta(s) sin una sola respuesta` : "") +
        `</span>` +
        (other
          ? `<br><span style="color:#86efac;font-size:11px;">El canal de ${other} sí entrega para este asunto: el despacho no alimenta esta fuente.</span>`
          : "");
    }
    // Sin fila registrada no se puede afirmar que antes sí recibía: se enuncia
    // sólo lo observado (la fuente contestó, pero nunca con contenido).
    if (!r.last_row_at && !r.rows_ever) {
      return `<strong style="color:${accent};">SIN CONTENIDO</strong><br>` +
        `<span style="color:#cbd5e1;font-size:11px;">La fuente contesta, pero no hay ninguna publicación registrada` +
        (r.attempts_total ? ` · ${r.attempts_total} consulta(s)` : "") + `</span>`;
    }
    return `<strong style="color:${accent};">DEJÓ DE RESPONDER</strong><br>` +
      `<span style="color:#cbd5e1;font-size:11px;">` +
      (r.last_row_at ? `Última publicación recibida: ${esc(r.last_row_at)}` : "Recibió publicaciones antes") +
      (r.rows_ever ? ` · ${r.rows_ever} en total` : "") + `</span>`;
  };
  // LY2 — se enuncia la forma observada del radicado, no una causa.
  // La frase de "ninguna publicación desde el alta" sólo aplica cuando en efecto
  // no hay ninguna fila registrada para ese asunto.
  const instanciaNote = (r: typeof rows[number]) => {
    if (r.instancia !== "SEGUNDA") return "";
    const sinFilas = !r.last_row_at && !r.rows_ever;
    return `<br><span style="color:#fbbf24;font-size:11px;">Segunda instancia` +
      (r.origin_monitored ? ` — su proceso de origen también está en seguimiento` : "") +
      (sinFilas
        ? `: el canal de estados no ha entregado ninguna publicación desde el alta.`
        : `.`) +
      `</span>`;
  };

  // MA1 — el despacho son los primeros 12 dígitos del radicado. Se enuncia
  // únicamente la comparación observada; no se afirma causa.
  const despachoCell = (r: typeof rows[number]) => {
    const code = r.despacho_code ? `<strong>${esc(r.despacho_code)}</strong>` : "—";
    const nombre = r.despacho_nombre
      ? `<br><span style="color:#cbd5e1;font-size:11px;">${esc(r.despacho_nombre)}</span>`
      : "";
    const cls = r.despacho_class;
    // MB1 — sin otro asunto en el mismo despacho no hay evidencia interna que
    // pueda cerrar el caso: es una verificación de portal, no un reporte de falla.
    const nota = cls === "OTRAS_SI_ENTREGAN"
      ? `El mismo despacho sí entrega para ${r.siblings_delivering} de ${r.siblings_monitored} asunto(s) más: la diferencia está en este radicado.`
      : cls === "NINGUNA_ENTREGA"
      ? `Ninguno de los ${r.siblings_monitored} asuntos de este despacho recibe ${ACTUACION_SOURCE_LABELS[r.source] ? "actuaciones" : "estados"} por ${esc(label(r.source))}: la diferencia está en el despacho.`
      : `Único asunto suyo en este despacho — no hay con qué comparar desde aquí; verificable solo en el portal.`;
    return `${code}${nombre}<br><span style="color:#94a3b8;font-size:11px;">${nota}</span>`;
  };
  // MB1 — los asuntos sin par se agrupan por NOMBRE de despacho para poder
  // revisarlos juzgado por juzgado en el portal.
  const soloDespachoBlock = () => {
    const solos = chronic.filter((r) => r.despacho_class === "SIN_COMPARACION");
    if (!solos.length) return "";
    const groups = new Map<string, typeof solos>();
    for (const r of solos) {
      const key = r.despacho_nombre || (r.despacho_code ? `Despacho ${r.despacho_code}` : "Despacho sin identificar");
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    const items = [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "es"))
      .map(([nombre, list]) =>
        `<li style="margin-bottom:4px;"><strong>${esc(nombre)}</strong>: ` +
        list.map((r) =>
          `${esc(r.radicado || "sin radicado")} (${r.attempts_total ?? 0} consulta(s))`
        ).join(", ") + `</li>`
      ).join("");
    return `<div style="font-size:12px;color:${MUTED};margin-top:10px;line-height:1.6;">
      <strong style="color:${accent};">Para revisar en el portal, por juzgado</strong><br>
      Estos asuntos son el único suyo en su despacho: desde aquí no hay otro asunto con el cual comparar,
      así que ninguna consulta adicional los resuelve. La verificación manual en el portal del juzgado es
      lo único que los ha cerrado hasta hoy.
      <ul style="margin:6px 0 0 16px;padding:0;">${items}</ul>
    </div>`;
  };
  // MA3 — el número de consultas es lo que distingue "expediente quieto" de
  // "petición que la fuente no puede satisfacer".
  const consultasCell = (r: typeof rows[number]) =>
    r.attempts_total
      ? `<strong style="color:${r.attempts_total >= 50 ? "#f87171" : accent};">${r.attempts_total} consulta(s)</strong>` +
        (!r.rows_ever ? `<br><span style="color:#cbd5e1;font-size:11px;">ni una respuesta con contenido</span>` : "")
      : "—";

  return sectionTitle(
    "Fuentes que llevan días sin entregar",
    accent,
    "Estos asuntos se consultan a diario y la fuente sigue sin responder con contenido. " +
      "No están pausados ni ocultos: lo que falta es la respuesta de la fuente, no el seguimiento. " +
      "Cuando un asunto acumula 14 días seguidos sin una sola respuesta con contenido, pasa a consultarse " +
      "una vez por semana: sigue en seguimiento, solo se pregunta menos.",
  ) +
    (() => {
      // El conteo se hace sobre filas efectivamente recibidas, no sobre la clase
      // calculada: un asunto que siempre contestó vacío tampoco recibió nada.
      const sinFilas = chronic.filter((r) => !r.last_row_at && !r.rows_ever).length;
      const conFilas = chronic.length - sinFilas;
      const segundas = chronic.filter((r) => r.instancia === "SEGUNDA").length;
      if (!chronic.length) return "";
      const mismoDespacho = chronic.filter((r) => r.despacho_class === "OTRAS_SI_ENTREGAN").length;
      const sinPares = chronic.filter((r) => r.despacho_class === "SIN_COMPARACION").length;
      return `<div style="font-size:12px;color:${MUTED};margin:0 0 8px;line-height:1.6;">` +
        `${sinFilas} de ${chronic.length} no han recibido ni una publicación desde su alta` +
        (conFilas ? `; los ${conFilas} restantes sí recibieron antes y dejaron de recibir. ` : ". ") +
        (segundas
          ? `${segundas} de ellos son segundas instancias. Es lo observado en el radicado; no afirmamos por qué la fuente no entrega. `
          : "") +
        `${mismoDespacho} está(n) en un despacho que sí entrega para otro asunto; ` +
        `${sinPares} no tiene(n) otro asunto en el mismo despacho con el cual comparar.` +
        `</div>`;
    })() +
    `<table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;background:${CARD};">
      <thead><tr>${th("Asunto", accent)}${th("Fuente", accent)}${th("Despacho (12 dígitos)", accent)}${th("Qué clase de silencio", accent)}${th("Consultas", accent)}${th("Días consecutivos", accent)}${th("Qué responde", accent)}</tr></thead>
      <tbody>${chronic.map((r) => `<tr>
        ${td(`<strong>${esc(r.radicado || "sin radicado")}</strong><br>` +
          `<span style="color:#cbd5e1;font-size:11px;">${esc(r.title || "—")}</span>` +
          (r.despacho ? `<br><span style="color:#94a3b8;font-size:11px;">${esc(r.despacho)}</span>` : "") +
          instanciaNote(r))}
        ${td(esc(label(r.source)))}
        ${td(despachoCell(r))}
        ${td(classCell(r))}
        ${td(consultasCell(r))}
        ${td(ageCell(r.consecutive_days, r.since_date) +
          (r.status === "JOINED_TODAY"
            ? `<br><span style="color:#f87171;font-size:11px;">Entró hoy a esta lista</span>`
            : ""))}
        ${td(esc(kindText(r.kind)) + (r.last_outcome ? ` (${esc(r.last_outcome)})` : ""))}
      </tr>`).join("")}</tbody>
    </table>
    ${soloDespachoBlock()}
    ${recovered.length ? `<div style="font-size:12px;color:#4ade80;margin-top:8px;line-height:1.6;">
      Salieron hoy de la lista: ${recovered.map((r) => esc(r.radicado || "sin radicado")).join(", ")}.
    </div>` : ""}
    <div style="font-size:12px;color:${MUTED};margin-top:8px;line-height:1.6;">
      Un asunto con pocos días es un tropiezo de la fuente. Un asunto con muchos días seguidos indica que
      conviene revisarlo directamente en el portal: seguimos consultando, pero no podemos afirmar que no haya
      movimiento en él.
    </div>`;
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
      ${acts.length ? `<div style="padding:8px 12px 2px;font-size:12px;font-weight:700;color:${ACT_ACCENT};">ACTUACIONES — actos en el expediente (${acts.length})</div>
      ${acts.some(isDecisionAct) ? `<div style="padding:0 12px 4px;font-size:11px;color:${MUTED};line-height:1.5;">Las actuaciones marcadas <b style="color:${TEXT};">DECISIÓN</b> se listan primero. El orden es de lectura: no altera ninguna cifra de este correo ni califica el contenido de la decisión.</div>` : ""}${actuacionesTable(acts, p.linkExpiryDays)}` : ""}
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
/**
 * AD1(d) — audiencias fijadas fuera del horizonte de 7 días. Se enumeran
 * compactas para que una audiencia fijada hoy para dentro de tres meses sea
 * visible hoy y no en la víspera.
 */
function hearingsBeyondBlock(rows: HearingRow[], p: DigestPayload): string {
  if (!rows.length) return "";
  return sectionTitle(
    `Audiencias posteriores (${rows.length})`,
    "#fbbf24",
    "Fijadas más allá de los próximos 7 días. Aparecerán en la agenda inmediata cuando entren en la ventana.",
  ) +
    `<table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;background:${CARD};">
      <thead><tr>${th("Fecha y hora", "#fbbf24")}${th("Asunto", "#fbbf24")}${th("Audiencia", "#fbbf24")}</tr></thead>
      <tbody>${rows.map((h) => {
        const wi = p.workItems.get(h.work_item_id);
        return `<tr>
          ${td(fmtDateTime(h.scheduled_at))}
          ${td(esc(wi?.radicado || wi?.title || "—"))}
          ${td(esc(h.title || "Audiencia"))}
        </tr>`;
      }).join("")}</tbody>
    </table>`;
}

/**
 * LV2/LV4 — the terms that are not running. Each says what actually closed it,
 * and a correspondence closure says plainly that an email is not compliance.
 * None of these is counted among his live terms.
 */
function unverifiedTermsBlock(p: DigestPayload): string {
  const rows = p.unverifiedTerms ?? [];
  if (!rows.length) return "";
  const LABELS: Record<string, string> = {
    CERRADO_POR_CORRESPONDENCIA_SIN_VERIFICAR: "Cerrado por correspondencia — sin verificar",
    VENCIDO_ANTES_DEL_MOTOR: "Vencido antes del motor de términos",
    VENCIDO_RETRODETECTADO: "Vencido — detectado después",
  };
  const accent = "#a78bfa";
  return `
    <div style="font-size:12px;font-weight:700;color:${accent};margin:16px 0 6px;">
      TÉRMINOS CERRADOS SIN VERIFICACIÓN (${rows.length}) — no cuentan como términos vivos
    </div>
    <table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;background:${CARD};margin-bottom:8px;">
      <thead><tr>${th("Asunto", accent)}${th("Término", accent)}${th("Vencimiento", accent)}${th("Por qué se cerró", accent)}</tr></thead>
      <tbody>${rows.map((d) => {
        const wi = p.workItems.get(d.work_item_id);
        const correo = d.correspondence_subject
          ? `<br><span style="color:#94a3b8;font-size:11px;">Correo: «${esc(d.correspondence_subject)}»${
              d.correspondence_sent_at ? ` · ${fmtDate(d.correspondence_sent_at.slice(0, 10))}` : ""
            }</span>`
          : "";
        const decidido = d.decided
          ? `<br><span style="color:#4ade80;font-size:11px;">Usted ya decidió sobre este cierre.</span>`
          : "";
        return `<tr>
          ${td(esc(wi?.radicado || wi?.title || "—"))}
          ${td(esc(d.label || d.deadline_type || "—"))}
          ${td(d.deadline_date ? fmtDate(d.deadline_date) : `<span style="color:#fbbf24;">SIN FECHA — REQUIERE REVISIÓN</span>`)}
          ${td(esc(LABELS[d.status] ?? d.status) + correo + decidido)}
        </tr>`;
      }).join("")}</tbody>
    </table>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:14px;">
      Un correo enviado al despacho dentro de la ventana del término es correspondencia, no constancia de cumplimiento.
      Confirme o reabra cada uno de estos términos desde el asunto. Los que aparecen SIN FECHA nunca se calcularon:
      no están corriendo ni vencidos, y quedan fuera de todo conteo.
    </div>`;
}

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
        // IZ3(a) — the court outranks the catalogue, and he must see when it did.
        const declared = d.declared
          ? `<br><span style="color:#fbbf24;font-size:11px;">Término declarado por el despacho${
              d.declared.catalog_days ? "" : ""
            }; la regla del catálogo${
              d.declared.catalog_days ? ` (${d.declared.catalog_days} días hábiles)` : ""
            }${d.declared.catalog_date ? ` habría dado el ${fmtDate(d.declared.catalog_date)}` : " habría dado otra fecha"}.</span>`
          : "";
        return `<tr>
          ${td(fmtDate(d.deadline_date))}
          ${td(esc(wi?.radicado || wi?.title || "—"))}
          ${td(esc(d.label || d.deadline_type || "—") + declared)}
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
        ? `<a href="${p.appBaseUrl}/app/work-items/${esc(r.work_item_id)}" style="font-size:12px;color:#a78bfa;">Revisar el expediente →</a>`
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
        ${td(`<a href="${p.appBaseUrl}/app/work-items/${esc(r.work_item_id)}" style="color:#60a5fa;">${esc(wi?.radicado || "Sin radicado")}</a>`)}
        ${td(esc(wi?.title || "—"))}
        ${td(esc(parts.join(" + ") || String(r.rows)))}
        ${td(esc(span))}
      </tr>`;
    }).join("")}</tbody>
  </table>`;
}

/**
 * IQ5(b) — matters an AUTOMATIC rule stopped monitoring. The two lines below
 * carry the whole lesson of the ghost defect and must survive editing.
 */
function autoPausedBlock(rows: AutoPausedItemRow[], appBaseUrl: string): string {
  if (!rows.length) return "";
  const anyRePaused = rows.some((r) => r.re_paused);
  return sectionTitle(
    `Asuntos que el sistema dejó de monitorear (${rows.length})`,
    "#f87171",
    "Estos asuntos fueron pausados por una regla automática, no por usted. Mientras estén así, no se consultan con ningún proveedor y sus novedades no aparecen en este resumen.",
  ) +
  `<table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;background:${CARD};">
    <thead><tr>${th("Radicado", "#f87171")}${th("Asunto", "#f87171")}${th("Tipo", "#f87171")}${th("Pausado el", "#f87171")}${th("Motivo registrado", "#f87171")}${th("¿Ya lo había reactivado?", "#f87171")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>
      ${td(`<a href="${appBaseUrl}/app/work-items/${esc(r.id)}" style="color:#f87171;">${esc(r.radicado || "Sin radicado")}</a>`)}
      ${td(esc(r.title || "—"))}
      ${td(esc(r.workflow_type || "—"))}
      ${td(fmtDate(r.paused_at))}
      ${td(esc(r.reason || "No registrado"))}
      ${td(r.re_paused
        ? `<span style="color:#f87171;font-weight:700;">Sí — ${r.reactivations} reactivación(es) suyas</span>`
        : `<span style="color:${MUTED};">No</span>`)}
    </tr>`).join("")}</tbody>
  </table>
  <div style="font-size:12px;color:${MUTED};margin-top:6px;">Lo que esto NO significa: que el expediente esté cerrado ni que no exista. El proveedor no lo afirmó; el sistema lo dedujo de la ausencia de filas.${anyRePaused ? " En las filas marcadas, el sistema está revirtiendo su decisión de forma repetida y eso indica un defecto de nuestro lado o una limitación real del proveedor, no una conclusión sobre el expediente." : ""}</div>`;
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

/**
 * ZZ2(d) — SUSCRITOS Y NUNCA CONSULTADOS. Matters with no successful provider
 * read ever and no stored act or estado. It is not "sin novedades": it is a
 * matter we have never actually seen.
 */
function neverReadBlock(rows: NeverReadRow[], appBaseUrl: string): string {
  if (!rows.length) return "";
  const verified = rows.filter((r) => r.classification === "MANUAL_NO_ACTS" || r.classification === "MANUAL_PRIVATE");
  const empty = rows.filter((r) => r.classification === "READ_EMPTY");
  const failures = rows.filter((r) => r.classification === "READ_FAILURE");
  const partial = rows.filter((r) => r.classification === "CHANNEL_PARTIAL");
  const table = (group: NeverReadRow[], accent: string, status: (r: NeverReadRow) => string) =>
    `<table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;background:${CARD};">
      <thead><tr>${th("Radicado", accent)}${th("Asunto", accent)}${th("Antigüedad", accent)}${th("Última verificación", accent)}${th("Lo que sabemos", accent)}</tr></thead>
      <tbody>${group.map((r) => `<tr>
        ${td(`<a href="${appBaseUrl}/app/work-items/${esc(r.id)}" style="color:${accent};">${esc(r.radicado || "Sin radicado")}</a>`)}
        ${td(esc(r.title || "—"))}
        ${td(r.days_since_alta === null ? "—" : `<strong style="color:${r.days_since_alta >= 90 ? "#f87171" : r.days_since_alta >= 30 ? "#fbbf24" : TEXT};">${r.days_since_alta} días</strong>`)}
        ${td(r.last_attempted_sync_at ? fmtDateTime(r.last_attempted_sync_at) : `<span style="color:${MUTED};">Nunca</span>`)}
        ${td(status(r))}
      </tr>`).join("")}</tbody></table>`;
  const blocks: string[] = [];
  if (verified.length) blocks.push(sectionTitle(
    `Verificación manual (${verified.length})`, "#34d399",
    "Estos expedientes fueron consultados directamente en el portal judicial. No requieren acción del abogado.",
  ) + table(verified, "#34d399", (r) => r.classification === "MANUAL_PRIVATE"
    ? `${reservaNoticeShort(r.workflow_type)} Verificación manual en el portal, ${fmtDate(r.verified_on)}.`

    : `El juzgado no ha emitido actuaciones (verificación manual en el portal, ${fmtDate(r.verified_on)}).`));
  if (empty.length) blocks.push(sectionTitle(
    `Lectura correcta, sin actuaciones (${empty.length})`, "#38bdf8",
    "El proveedor respondió correctamente y no entregó actuaciones. Esto no es una falla de lectura.",
  ) + table(empty, "#38bdf8", () => "Lectura respondida sin actuaciones."));
  // AB3 / IZ2(d) — the per-channel case. These matters DO have estados on file;
  // describing them as having nothing registrado would be false.
  if (partial.length) blocks.push(sectionTitle(
    `Leído por un canal solamente (${partial.length})`, "#fbbf24",
    "Estos expedientes sí tienen estados registrados. Lo que falta es la lectura del otro canal, no el expediente.",
  ) + table(partial, "#fbbf24", () =>
    "Cobertura parcial: nunca leído por CPNU; sí por estados. No es un expediente sin registro."));
  if (failures.length) blocks.push(sectionTitle(
    `Problema de lectura de Andromeda (${failures.length})`, "#f87171",
    "Andrómeda no ha logrado completar la lectura; es un problema nuestro, no del juzgado.",
  ) + table(failures, "#f87171", (r) => `<strong>${esc(r.last_error_code || "UNCLASSIFIED")}</strong><br><span style="color:${MUTED};">${esc(r.diagnostic_detail || "Sin detalle disponible")}</span>`));
  return blocks.join("");
}

export function buildDigestHtml(p: DigestPayload): string {
  const total = p.actuaciones.length + p.estados.length;
  const greeting = p.recipientName ? `Buenos días, ${esc(p.recipientName)}.` : "Buenos días.";

  // TT6 — the headline count is only a statement about what we READ. When a
  // source failed to cover the portfolio the sentence must say so in the same
  // breath, never afterwards and never in small print.
  // ZZ2(b) — the window stated as a day the reader can check, with the exact
  // boundaries beside it.
  const win = `del día ${esc(p.windowLabel)} (${fmtDateTime(p.windowFrom)} → ${fmtDateTime(p.windowTo)}, hora de Bogotá)`;
  // LW2 — nombrar la fuente parcial y la fuente completa. Decir «cobertura
  // incompleta» cuando una fuente leyó toda su cadena es falso sobre esa fuente.
  const partials = (p.sourceQuality ?? []).filter(
    (r) => (r.expected_count || 0) > 0 && (r.answered_count ?? r.usable_confirmed_count) < r.expected_count,
  );
  const completas = (p.sourceQuality ?? []).filter(
    (r) => (r.expected_count || 0) > 0 && (r.answered_count ?? r.usable_confirmed_count) >= r.expected_count,
  );
  const nombres = (list: typeof partials) => list.map((r) => esc(r.label)).join(", ");
  // LX — the headline reports MOVEMENT, not the standing population. The same
  // sixteen matters every morning under the word "incompleta" is a warning that
  // stops being read; "sin cambios" says the truth and points at the section
  // that holds the names and their age.
  const pers = p.coveragePersistence ?? [];
  const joined = pers.filter((r) => r.status === "JOINED_TODAY");
  const recovered = pers.filter((r) => r.status === "RECOVERED_TODAY");
  const standing = pers.filter((r) => r.status !== "RECOVERED_TODAY");
  const rad = (list: typeof pers) => list.map((r) => esc(r.radicado || "sin radicado")).join(", ");
  const coberturaFrase = !partials.length
    ? `<strong style="color:#4ade80;">Todas las fuentes leyeron completa su cadena.</strong>`
    : joined.length || recovered.length
    ? `<strong style="color:#fbbf24;">Cambió la cobertura hoy</strong>: ` +
      [
        joined.length ? `entró(aron) ${rad(joined)}` : "",
        recovered.length ? `salió(eron) ${rad(recovered)}` : "",
      ].filter(Boolean).join("; ") +
      `. Ver «Fuentes que llevan días sin entregar».`
    : `<strong style="color:#94a3b8;">La cobertura no cambió</strong>: siguen los mismos ` +
      `${standing.length} asunto(s) sin entrega de ${nombres(partials)}, sin altas ni bajas. ` +
      `Ver «Fuentes que llevan días sin entregar».`;
  const headline = `${greeting} ${total} novedad(es) detectadas ${win}. ${coberturaFrase}`;

  return `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:${BG};">
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:920px;margin:0 auto;padding:24px;background:${BG};color:${TEXT};">
    <div style="font-size:20px;font-weight:800;color:#f8fafc;">Andromeda — Resumen diario</div>
    <div style="font-size:13px;color:${MUTED};margin-top:4px;">
      ${headline}
    </div>

    ${connectionBlock(p.connectionIssues, p.appBaseUrl)}
    ${statStripBlock(p)}
    ${sourceQualityBlock(p)}
    ${persistenceBlock(p)}
    ${novedadesBlock(p)}
    ${reconciliationBlock(p.reconciliations ?? [], p)}
    ${importedHistoryBlock(p)}
    ${hearingsBlock(p.hearings, p)}
    ${hearingsBeyondBlock(p.hearingsBeyond ?? [], p)}
    ${deadlinesBlock(p.deadlines, p)}
    ${unverifiedTermsBlock(p)}
    ${nonJudicialBlock(p.nonJudicialDeadlines, p)}
    ${neverReadBlock(p.neverRead ?? [], p.appBaseUrl)}
    ${autoPausedBlock(p.autoPaused, p.appBaseUrl)}

    <div style="margin-top:28px;padding-top:14px;border-top:1px solid ${BORDER};font-size:12px;color:${MUTED};line-height:1.6;">
      <div><strong style="color:${TEXT};">${p.monitoredCount}</strong> asuntos judiciales en monitoreo activo con proveedores.
      ${p.nonJudicialCount > 0
        ? `<strong style="color:${TEXT};">${p.nonJudicialCount}</strong> asuntos no judiciales (peticiones / actuaciones administrativas), que no se consultan con ningún proveedor.`
        : "Sin asuntos no judiciales activos."}
      Las dos cifras no se suman: son universos distintos.</div>
      <div>Los asuntos eliminados no se incluyen ni se cuentan. No existe un estado intermedio: un asunto que existe se monitorea.</div>
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
