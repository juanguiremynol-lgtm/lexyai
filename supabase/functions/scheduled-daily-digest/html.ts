import { sourceGaps } from "../_shared/sourceRunQuality.ts";
import { digestCoverageIncomplete } from "./content.ts";
import {
  actuacionSourceLabel,
  estadoSourceLabel,
  type DeadlineRow,
  type DigestDocument,
  type DigestPayload,
  type DocumentAvailability,
  type HearingRow,
  type ProvidenciaCrossRef,
} from "./types.ts";

export const DIGEST_RENDERER_REVISION = "20261121-resumen-esencial-v2";

const colors = { ink: "#162137", muted: "#4a5b70", line: "#dce4ed", blue: "#12478a", danger: "#8a271c" };
const timeZone = "America/Bogota";
const civilFormat = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone });
const timeFormat = new Intl.DateTimeFormat("es-CO", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone,
});

function esc(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function clipped(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

function civil(value: string | null | undefined): string {
  const day = value?.match(/^\d{4}-\d{2}-\d{2}(?=$|T| )/)?.[0];
  if (!day) return "Fecha sin registrar";
  const date = new Date(day + "T12:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day
    ? civilFormat.format(date) : "Fecha sin registrar";
}

function moment(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? timeFormat.format(date) : "Fecha u hora sin registrar";
}

function link(url: string | undefined, label: string): string {
  if (url) {
    try {
      const location = new URL(url);
      if (location.protocol === "https:" || location.protocol === "http:") {
        return `<a href="${esc(url)}" style="color:${colors.blue};text-decoration:underline;">${esc(label)}</a>`;
      }
    } catch { /* Display the label when the URL is unavailable. */ }
  }
  return esc(label);
}

function line(content: string): string {
  return content ? `<p style="margin:4px 0 0;font-size:13px;line-height:1.5;color:${colors.muted};">${content}</p>` : "";
}

function section(title: string, content: string): string {
  if (!content) return "";
  return `<div style="margin:25px 0 0;"><h2 style="margin:0 0 8px;font-size:19px;line-height:1.3;color:${colors.ink};">${esc(title)}</h2>${content}</div>`;
}

function row(heading: string, details = ""): string {
  return `<div style="padding:9px 0;border-bottom:1px solid ${colors.line};"><div style="font-weight:600;line-height:1.45;">${heading}</div>${details}</div>`;
}

function workItem(p: DigestPayload, id: string, showTitle = false): string {
  const item = p.workItems.get(id);
  const url = `${p.appBaseUrl}/app/work-items/${encodeURIComponent(id)}`;
  const label = showTitle ? (item?.title || item?.radicado) : (item?.radicado || item?.title);
  return link(url, clipped(label || "Ver expediente", 145));
}

function calendar(p: DigestPayload, key: string): string[] {
  const urls = p.calendarLinks?.get(key);
  return urls ? [link(urls.ics, "Añadir al calendario (.ics)"), link(urls.google, "Google"), link(urls.outlook, "Outlook")] : [];
}

const noAttachment: Record<DocumentAvailability, string> = {
  DISPONIBLE: "Enlace al documento no disponible en el correo",
  CONSTANCIA_SIN_DOCUMENTO: "Fijación registrada sin planilla adjunta",
  RETENCION_VENCIDA_EN_ORIGEN: "El proveedor ya no conserva la copia",
  SIN_DOCUMENTO: "Sin documento adjunto",
  NO_CONSULTADO: "Documento pendiente de consulta",
};

function documents(rows: DigestDocument[], availability: DocumentAvailability, viaCounterpart: string | null): string {
  if (!rows.length) return line(noAttachment[availability]);
  const attachments = rows.map((doc) => link(doc.url, clipped(doc.label || "Abrir documento", 95)));
  return line((viaCounterpart ? `Documento de ${viaCounterpart} · ` : "") + attachments.join(" · "));
}

function crossReference(ref: ProvidenciaCrossRef | null | undefined, kind: "estado" | "actuación"): string {
  if (!ref) return "";
  if (ref.confidence !== "ALTA") return line(`Vínculo con ${kind} por confirmar`);
  const date = kind === "estado" ? ref.fecha_fijacion : ref.act_date;
  return line(esc(`Providencia vinculada a ${kind}` + (date ? ` · ${civil(date)}` : "")));
}

function coverage(p: DigestPayload): string {
  if (!p.coverageIncomplete && !digestCoverageIncomplete(p.sourceQuality)) {
    return p.sourceQuality.filter((s) => (s.excluded_by_profile ?? 0) > 0)
      .map((s) => line(esc(`${s.label} · ${s.excluded_by_profile} fuera del alcance de esta fuente`))).join("");
  }
  const pending = p.sourceQuality.filter((s) => digestCoverageIncomplete([s]));
  const sources = pending.map((s) => {
    const valid = Number.isFinite(s.expected_count) && Number.isFinite(s.usable_confirmed_count) && s.expected_count > 0;
    const gaps = sourceGaps(s);
    const counts = valid ? `${gaps.usable}/${gaps.expected} lecturas confirmadas` : "lectura sin verificar";
    const states = [counts, s.success_empty_count > 0 ? `${s.success_empty_count} sin novedades en lecturas confirmadas` : "",
      gaps.sinRespuesta > 0 ? `${gaps.sinRespuesta} sin respuesta` : "",
      gaps.sinLecturaConfirmada > 0 ? `${gaps.sinLecturaConfirmada} sin lectura confirmada` : "",
      s.excluded_by_profile ? `${s.excluded_by_profile} fuera del alcance de esta fuente` : "",
      s.restricted_count > 0 ? `${s.restricted_count} con acceso restringido` : ""].filter(Boolean);
    return line(`<strong>${esc(s.label)}</strong> · ${esc(s.check_failed ? "Verificación no disponible" : states.join(" · "))}`);
  }).join("");
  const affected = new Set(p.coverageExceptions.map((r) => r.work_item_id).filter(Boolean)).size;
  const scope = affected ? line(esc(`Expedientes de su cartera con incidencias registradas · ${affected}`)) : "";
  const period = p.coverageWindowFrom !== p.windowFrom || p.coverageWindowTo !== p.windowTo
    ? line(esc(`Control de fuentes · ${moment(p.coverageWindowFrom)} – ${moment(p.coverageWindowTo)}`)) : "";
  return `<div style="margin:16px 0 0;padding:12px 15px;background:#fff5e9;border-left:4px solid #a95714;">
    <strong style="color:${colors.danger};">Cobertura por verificar</strong>
    ${line("La vigilancia quedó incompleta. Aún pueden existir novedades pendientes.")}${sources}${scope}${period}</div>`;
}

function caseUpdates(p: DigestPayload): string {
  const ids = new Set([...p.estados.map((r) => r.work_item_id), ...p.actuaciones.map((r) => r.work_item_id)]);
  const groups = new Map([...ids].map((id) => [id, { estados: [] as typeof p.estados, actuaciones: [] as typeof p.actuaciones }]));
  for (const record of p.estados) groups.get(record.work_item_id)!.estados.push(record);
  for (const record of p.actuaciones) groups.get(record.work_item_id)!.actuaciones.push(record);
  return [...groups].map(([id, group]) => {
    const item = p.workItems.get(id);
    const title = `<h3 style="margin:12px 0 3px;font-size:15px;">${workItem(p, id, true)}</h3>`;
    const radicado = item?.radicado && item?.title ? line(esc(item.radicado)) : "";
    const states = group.estados.map((state) => row(esc(clipped(state.title || "Publicación judicial", 170)),
      line(esc(`Estado · ${estadoSourceLabel(state.source)} · Fijación ${civil(state.fecha_fijacion)}` +
        (state.fecha_actuacion ? ` · Actuación ${civil(state.fecha_actuacion)}` : ""))) +
      (state.observacion && state.observacion !== state.title ? line(esc(clipped(state.observacion, 155))) : "") +
      crossReference(state.crossRef, "actuación") +
      documents(state.documents, state.document_availability, state.crossRef?.documents_borrowed ? "la actuación" : null))).join("");
    const acts = group.actuaciones.map((act) => row(esc(clipped(act.description || act.act_type || "Actuación judicial", 170)),
      line(esc(`Actuación · ${actuacionSourceLabel(act.source)} · ${civil(act.act_date)}`)) +
      (act.annotation && act.annotation !== act.description ? line(esc(clipped(act.annotation, 155))) : "") +
      crossReference(act.crossRef, "estado") +
      documents(act.documents, act.document_availability, act.crossRef?.documents_borrowed ? "la publicación en estado" : null))).join("");
    return title + radicado + states + acts;
  }).join("");
}

function hearing(p: DigestPayload, h: HearingRow): string {
  return row(esc(clipped(h.title || "Audiencia", 120)),
    line(esc(moment(h.scheduled_at)) + " · " + workItem(p, h.work_item_id)) +
    line((h.is_virtual && h.virtual_link ? [link(h.virtual_link, "Entrar a la audiencia")] :
      h.location ? [esc(clipped(h.location, 120))] : []).concat(calendar(p, `H:${h.id}`)).join(" · ")));
}

function deadline(p: DigestPayload, d: DeadlineRow, own: boolean): string {
  const urgency = d.overdue ? "Vencido" : d.days_left === 0 ? "Vence hoy" : "Vence";
  const date = own ? `${urgency} · ${civil(d.deadline_date)}` : `Fecha ${civil(d.deadline_date)}`;
  return row(esc(clipped(d.label || d.deadline_type || "Término", 150)),
    line(esc(date) + " · " + workItem(p, d.work_item_id) +
      (d.declared ? " · Fecha indicada por el despacho" : "")) +
    (own && !d.overdue && d.status === "PENDING" ? line(calendar(p, `T:${d.id}`).join(" · ")) : ""));
}

function manualReview(p: DigestPayload): string {
  const rows = p.manualReviewTerms ?? [];
  const total = Math.max(p.manualReviewTotal ?? 0, rows.length);
  const changed = Math.max(p.manualReviewChangedTotal ?? 0, rows.length);
  if (!total) return "";
  const rest = Math.max(0, changed - rows.length);
  const title = p.manualReviewTotal === null ? "Términos en revisión" : `Términos en revisión (${total})`;
  return section(title, line("Pendientes de validar la clasificación o la fecha.") +
    rows.map((r) => row(esc(clipped(r.label || r.deadline_type || "Término", 165)),
      line(workItem(p, r.work_item_id) + " · Sin fecha validada"))).join("") +
    line((rest ? `${rest} cambios más · ` : "") + link(p.appBaseUrl + "/app/hearings", "Ver todas las revisiones")));
}

function operationalAlerts(p: DigestPayload): string {
  const connections = p.connectionIssues.map((c) => row(esc(c.headline || "Conexión de correo"),
    line(esc([c.mailbox, c.detail ? clipped(c.detail, 165) : null].filter(Boolean).join(" · "))) +
    line(link(p.appBaseUrl + "/app/settings/connections", "Revisar conexión")))).join("");
  const dates = p.fechasPorPerder ?? [];
  const atRisk = dates.map((r) => row(esc("SAMAI Estados · Despacho " + r.despacho),
    line(esc(r.motivo === "DESPLEGABLE_SIN_LEER" ? "Listado de fijaciones pendiente de lectura" :
      `Fijación pendiente de lectura · ${civil(r.fecha)}` +
      (r.fechas_para_salir == null ? "" : ` · ${r.fechas_para_salir} publicaciones para salir del listado`))))).join("");
  const unavailable = p.unavailableChecks?.length
    ? line(esc("No se pudieron consultar " + p.unavailableChecks.join(", ") + "."))
    : "";
  return connections + atRisk + unavailable +
    (p.fechasPorPerderUnavailable ? line("No se pudo comprobar qué fijaciones de SAMAI están en riesgo.") : "");
}

function additionalItems(p: DigestPayload): string {
  const reconciled = (p.reconciliations ?? []).map((r) => row(esc(r.headline),
    line(esc(r.detail)) + (r.work_item_id ? line(workItem(p, r.work_item_id)) : ""))).join("");
  const imported = p.importedHistory.length
    ? line(esc(`Historial incorporado · ${p.importedHistory.reduce((n, r) => n + r.rows, 0)} registros previos en ${p.importedHistory.length} expedientes`)) : "";
  const paused = p.autoPaused.map((item) => row(link(`${p.appBaseUrl}/app/work-items/${encodeURIComponent(item.id)}`,
    item.radicado || item.title || "Ver expediente"),
    line((item.re_paused ? "Vigilancia suspendida de nuevo por el sistema" : "Vigilancia suspendida por el sistema") +
      (item.paused_at ? " · " + esc(moment(item.paused_at)) : "")))).join("");
  const unverified = p.unverifiedTerms.filter((r) => !r.decided);
  const pendingTermClosures = unverified.length ? line(esc(`${unverified.length} cierres de términos pendientes de verificar`) +
    " · " + link(p.appBaseUrl + "/app/hearings", "Revisar cierres")) : "";
  const unread = p.neverRead.filter((r) => r.classification === "READ_FAILURE").length;
  const onlyPub = p.neverRead.filter((r) => r.classification === "CHANNEL_PARTIAL").length;
  const privateReview = p.neverRead.filter((r) => r.classification === "MANUAL_PRIVATE").length;
  const pastCoverage = (unread ? line(esc(`${unread} expedientes sin lectura completa registrada`)) : "") +
    (onlyPub ? line(esc(`${onlyPub} expedientes con estados y sin lectura confirmada de CPNU`)) : "") +
    (privateReview ? line(esc(`${privateReview} expedientes con acceso restringido verificado manualmente`)) : "");
  const gaps = p.coveragePersistence ?? [];
  const joined = gaps.filter((r) => r.status === "JOINED_TODAY").length;
  const recovered = gaps.filter((r) => r.status === "RECOVERED_TODAY").length;
  const chronic = gaps.filter((r) => r.status === "CHRONIC").length;
  const movement = [joined ? `${joined} nuevas` : "", recovered ? `${recovered} resueltas` : "",
    chronic ? `${chronic} persistentes` : ""].filter(Boolean);
  const changed = movement.length ? line(esc(`Incidencias por expediente y fuente · ${movement.join(" · ")}`)) : "";
  const reasons: Record<string, string> = { RESTRICTED: "Acceso restringido", READ_FAILED: "Error de lectura", PENDING_UPSTREAM: "Pendiente del proveedor" };
  const detailed = [...p.coverageExceptions].sort((a, b) => (b.last_attempt_at || "").localeCompare(a.last_attempt_at || ""));
  const latest = detailed.slice(0, 3).map((r) => {
    const gap = gaps.find((g) => g.source === r.source && g.work_item_id === r.work_item_id);
    const provider = p.sourceQuality.find((s) => s.source === r.source)?.label || r.source;
    const details = [provider, reasons[r.kind] || "Lectura pendiente", gap?.instancia === "SEGUNDA" ? "Segunda instancia" : "",
      gap?.gap_class === "NEVER_ANSWERED" ? "Sin respuesta desde la inscripción" : "",
      gap?.last_row_at ? "Último registro " + civil(gap.last_row_at) : "",
      gap?.consecutive_days ? `${gap.consecutive_days} días con la incidencia` : ""].filter(Boolean);
    return line(workItem(p,r.work_item_id) + " · " + esc(details.join(" · ")));
  }).join("");
  const rest = detailed.length > 3 ? line(esc(`${detailed.length - 3} incidencias más en la cartera`)) : "";
  return section("Seguimiento", reconciled + imported + paused + pendingTermClosures + pastCoverage + changed + latest + rest);
}

export function buildDigestHtml(p: DigestPayload): string {
  const updates = p.actuaciones.length + p.estados.length;
  const name = updates === 1 ? "1 novedad registrada" : `${updates} novedades registradas`;
  const own = p.deadlines.filter((r) => r.attribution === "PROPIO");
  const counterparty = p.deadlines.filter((r) => r.attribution === "CONTRAPARTE").length;
  const court = p.deadlines.filter((r) => r.attribution === "JUEZ").length;
  const unassigned = p.deadlines.length - own.length - counterparty - court;
  const termOrder = [...own].sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.deadline_date.localeCompare(b.deadline_date));
  const tracking = [counterparty ? `${counterparty} de contraparte` : "", court ? `${court} del despacho` : "",
    unassigned ? `${unassigned} por atribuir` : ""].filter(Boolean);
  const passive = tracking.length ? line(esc(tracking.join(" · ")) + " · " + link(p.appBaseUrl + "/app/hearings", "Ver términos de seguimiento")) : "";
  const hearings = [...p.hearings].sort((a,b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const later = [...(p.hearingsBeyond ?? [])].sort((a,b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const laterCount = Math.max(p.hearingsBeyondTotal ?? 0, later.length);
  const laterSummary = later.length
    ? line(esc(laterCount === 1 ? "Una audiencia después de los próximos 7 días" : `${laterCount} audiencias después de los próximos 7 días`)) +
      hearing(p, later[0]) + (laterCount > 1 ? line(link(p.appBaseUrl + "/app/hearings", "Ver toda la agenda")) : "") : "";
  const terms = termOrder.map((d) => deadline(p,d,true)).join("") + passive;
  const administrative = p.nonJudicialDeadlines.length
    ? section("Asuntos administrativos", p.nonJudicialDeadlines.map((d) => deadline(p,d,d.attribution === "PROPIO")).join("")) : "";
  const footer = [...p.actuaciones, ...p.estados].some((r) => r.documents.length)
    ? line(esc(`Los enlaces de descarga tienen una vigencia de ${p.linkExpiryDays} días.`)) : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Andromeda · Resumen diario</title></head>
<body style="margin:0;background:#eef2f6;color:${colors.ink};font-family:Arial,'Segoe UI',sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f6;"><tr><td align="center" style="padding:18px 10px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:635px;background:#ffffff;border:1px solid ${colors.line};">
<tr><td align="left" style="padding:23px 22px;border-top:5px solid #12478a;font-size:15px;line-height:1.45;">
<p style="margin:0;color:${colors.blue};font-size:15px;font-weight:700;">Andromeda</p>
<h1 style="margin:5px 0;font-size:28px;line-height:1.2;">Resumen diario</h1>
${line(esc(`${moment(p.windowFrom)} – ${moment(p.windowTo)} · Hora de Bogotá`))}
<p style="margin:13px 0 0;font-weight:700;">${esc(name)}</p>
${coverage(p)}
${section("Alertas", operationalAlerts(p))}
${section(own.length ? "Términos propios" : "Términos de seguimiento", terms)}
${section("Novedades por expediente", caseUpdates(p))}
${section("Audiencias", hearings.map((h) => hearing(p,h)).join("") + laterSummary)}
${manualReview(p)}
${administrative}
${additionalItems(p)}
<div style="margin-top:22px;padding-top:12px;border-top:1px solid ${colors.line};">${line(link(p.appBaseUrl + "/app", "Abrir Andromeda"))}${footer}</div>
</td></tr></table>
</td></tr></table></body></html>`;
}
