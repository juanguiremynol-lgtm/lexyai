/**
 * Memorial de Impulso Procesal — Template definitions and variable resolution.
 *
 * Each template type defines a canonical body text with {{variable}} placeholders.
 * The header and footer blocks are shared across all types.
 * Extra fields (type-specific inputs like audience_type) are declared per template.
 */

import { buildCourtHeaderHtml, autoSelectCourtMode, inferCourtEmail, type CourtHeaderData } from "@/lib/court-header-utils";
import type { WorkItemParty } from "@/lib/party-utils";

// ─── Memorial Type Registry ─────────────────────────────

export type MemorialType =
  | "impulso_general"
  | "fijacion_audiencia"
  | "pronunciamiento_pendiente"
  | "vencimiento_terminos"
  | "impulso_tras_auto"
  | "notificacion_demandado"
  | "decreto_pruebas"
  | "solicitud_sentencia"
  | "personalizado";

export interface MemorialTypeOption {
  value: MemorialType;
  label: string;
  description: string;
}

export const MEMORIAL_TYPE_OPTIONS: MemorialTypeOption[] = [
  { value: "impulso_general", label: "Impulso procesal general", description: "Solicitud genérica para impulsar el trámite del proceso" },
  { value: "fijacion_audiencia", label: "Solicitud de fijación de fecha de audiencia", description: "Pedir al juez que fije fecha para una audiencia específica" },
  { value: "pronunciamiento_pendiente", label: "Solicitud de pronunciamiento sobre escrito pendiente", description: "Pedir al juez que se pronuncie sobre un escrito presentado" },
  { value: "vencimiento_terminos", label: "Requerimiento por vencimiento de términos", description: "Informar al juez que los términos procesales están vencidos" },
  { value: "impulso_tras_auto", label: "Solicitud de impulso tras auto admisorio", description: "Solicitar avance del proceso tras notificación del auto admisorio" },
  { value: "notificacion_demandado", label: "Solicitud de notificación al demandado", description: "Solicitar que se perfeccione la notificación al demandado" },
  { value: "decreto_pruebas", label: "Solicitud de decreto y práctica de pruebas", description: "Solicitar que se decreten y practiquen las pruebas solicitadas" },
  { value: "solicitud_sentencia", label: "Solicitud de sentencia", description: "Solicitar que se profiera la sentencia correspondiente" },
  { value: "personalizado", label: "Personalizado (redacción libre)", description: "Solo encabezado y pie — usted redacta el cuerpo del memorial" },
];

// ─── Extra Fields per Type ──────────────────────────────

export interface ExtraFieldDef {
  key: string;
  label: string;
  type: "select" | "text" | "date";
  options?: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
}

export function getExtraFields(memorialType: MemorialType): ExtraFieldDef[] {
  switch (memorialType) {
    case "fijacion_audiencia":
      return [{
        key: "audience_type",
        label: "Tipo de audiencia",
        type: "select",
        required: true,
        options: [
          { value: "audiencia inicial (Art. 372 CGP)", label: "Audiencia inicial (Art. 372 CGP)" },
          { value: "audiencia de instrucción y juzgamiento (Art. 373 CGP)", label: "Audiencia de instrucción y juzgamiento (Art. 373 CGP)" },
          { value: "audiencia de conciliación, decisión de excepciones previas, saneamiento y fijación del litigio", label: "Audiencia de conciliación, saneamiento y fijación del litigio" },
          { value: "audiencia única (proceso verbal sumario, Art. 392 CGP)", label: "Audiencia única (Art. 392 CGP)" },
          { value: "diligencia de secuestro", label: "Diligencia de secuestro" },
          { value: "diligencia de entrega", label: "Diligencia de entrega" },
        ],
      }];
    case "pronunciamiento_pendiente":
      return [
        {
          key: "pending_document_type",
          label: "Tipo de escrito",
          type: "select",
          required: true,
          options: [
            { value: "escrito", label: "Escrito" },
            { value: "memorial", label: "Memorial" },
            { value: "demanda", label: "Demanda" },
            { value: "recurso de reposición", label: "Recurso de reposición" },
            { value: "recurso de apelación", label: "Recurso de apelación" },
            { value: "solicitud de pruebas", label: "Solicitud de pruebas" },
            { value: "alegatos de conclusión", label: "Alegatos de conclusión" },
          ],
        },
        { key: "pending_document_date", label: "Fecha de presentación del escrito", type: "date", required: true },
      ];
    case "vencimiento_terminos":
      return [
        { key: "specific_action", label: "Acción vencida", type: "text", placeholder: "ej. resolver la solicitud de pruebas", required: true },
        { key: "reason_for_delay", label: "Motivo / contexto", type: "text", placeholder: "ej. han transcurrido más de 30 días desde la solicitud", required: true },
      ];
    case "impulso_tras_auto":
      return [{
        key: "next_step",
        label: "Siguiente paso procesal",
        type: "select",
        required: true,
        options: [
          { value: "fijar fecha para audiencia inicial", label: "Fijar fecha para audiencia inicial" },
          { value: "decretar las pruebas solicitadas", label: "Decretar las pruebas solicitadas" },
          { value: "correr traslado de las excepciones de mérito", label: "Correr traslado de excepciones de mérito" },
          { value: "resolver sobre las excepciones previas propuestas", label: "Resolver sobre excepciones previas" },
        ],
      }];
    default:
      return [];
  }
}

// ─── Audience Type → Legal Basis Mapping ────────────────

function getLegalBasisForAudienceType(audienceType: string): { legal_basis: string; legal_article: string } {
  if (audienceType.includes("372")) return { legal_basis: "artículo 372 del Código General del Proceso", legal_article: "372" };
  if (audienceType.includes("373")) return { legal_basis: "artículo 373 del Código General del Proceso", legal_article: "373" };
  if (audienceType.includes("392")) return { legal_basis: "artículo 392 del Código General del Proceso", legal_article: "392" };
  if (audienceType.includes("conciliación")) return { legal_basis: "artículos 372 y 101 del Código General del Proceso", legal_article: "372" };
  return { legal_basis: "Código General del Proceso", legal_article: "correspondiente" };
}

// ─── Process Type from Workflow ─────────────────────────

function inferProcessType(workflowType: string): string {
  const types: Record<string, string> = {
    CGP: "civil",
    CPACA: "contencioso administrativo",
    TUTELA: "tutela",
    LABORAL: "laboral",
    PENAL_906: "penal",
  };
  return types[workflowType] || "civil";
}

// ─── Party Formatting ───────────────────────────────────

function formatPartyNames(parties: WorkItemParty[]): string {
  const names = parties
    .map(p => p.party_type === "juridica" ? (p.company_name || p.name) : p.name)
    .filter(Boolean);
  if (names.length === 0) return "—";
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(", ") + " y " + names[names.length - 1];
}

// ─── Variable Resolution ────────────────────────────────

export interface MemorialVariables {
  // Court header
  judge_name: string;
  court_name: string;
  court_city: string;
  court_email: string;
  // Case
  radicado: string;
  plaintiff_names: string;
  defendant_names: string;
  process_type: string;
  represented_side: string;
  // Lawyer
  lawyer_full_name: string;
  lawyer_cedula: string;
  lawyer_tarjeta_profesional: string;
  lawyer_litigation_email: string;
  // Extra fields (type-specific)
  [key: string]: string;
}

export interface MemorialContext {
  workItem: {
    id: string;
    radicado?: string | null;
    workflow_type: string;
    authority_name?: string | null;
    authority_city?: string | null;
    authority_department?: string | null;
    authority_email?: string | null;
    demandantes?: string | null;
    demandados?: string | null;
  };
  parties: WorkItemParty[];
  profile: {
    full_name?: string | null;
    firma_abogado_nombre_completo?: string | null;
    firma_abogado_cc?: string | null;
    firma_abogado_tp?: string | null;
    firma_abogado_correo?: string | null;
    litigation_email?: string | null;
    email?: string | null;
  };
  courtEmail?: string | null;
}

export function resolveMemorialVariables(ctx: MemorialContext): MemorialVariables {
  const clientParties = ctx.parties.filter(p => p.is_our_client);
  const opposingParties = ctx.parties.filter(p => !p.is_our_client);

  // Determine represented side
  const representedSide = clientParties[0]?.party_side || "demandante";
  const sideLabel: Record<string, string> = {
    demandante: "demandante",
    demandado: "demandada",
  };

  // Determine plaintiff/defendant names from parties or fallback to work item fields
  let plaintiffNames: string;
  let defendantNames: string;

  if (ctx.parties.length > 0) {
    const demandantes = ctx.parties.filter(p => p.party_side === "demandante");
    const demandados = ctx.parties.filter(p => p.party_side === "demandado");
    plaintiffNames = demandantes.length > 0 ? formatPartyNames(demandantes) : (ctx.workItem.demandantes || "—");
    defendantNames = demandados.length > 0 ? formatPartyNames(demandados) : (ctx.workItem.demandados || "—");
  } else {
    plaintiffNames = ctx.workItem.demandantes || "—";
    defendantNames = ctx.workItem.demandados || "—";
  }

  return {
    judge_name: "",
    court_name: ctx.workItem.authority_name || "",
    court_city: ctx.workItem.authority_city || "",
    court_email: ctx.courtEmail || ctx.workItem.authority_email || "",
    radicado: ctx.workItem.radicado || "",
    plaintiff_names: plaintiffNames,
    defendant_names: defendantNames,
    process_type: inferProcessType(ctx.workItem.workflow_type),
    represented_side: sideLabel[representedSide] || "demandante",
    lawyer_full_name: ctx.profile.firma_abogado_nombre_completo || ctx.profile.full_name || "",
    lawyer_cedula: ctx.profile.firma_abogado_cc || "",
    lawyer_tarjeta_profesional: ctx.profile.firma_abogado_tp || "",
    lawyer_litigation_email: ctx.profile.firma_abogado_correo || ctx.profile.litigation_email || ctx.profile.email || "",
  };
}

// ─── Text Generation ────────────────────────────────────

function replaceVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`);
}

function buildHeader(vars: MemorialVariables): string {
  const lines: string[] = [];

  if (vars.court_name) {
    lines.push("Doctor(a)");
    if (vars.judge_name) lines.push(vars.judge_name.toUpperCase());
    lines.push(vars.court_name);
    lines.push("Rama Judicial del Poder Público");
    if (vars.court_city) lines.push(vars.court_city);
    if (vars.court_email) lines.push(vars.court_email);
  } else {
    lines.push("Señor(a) Juez");
    lines.push("Rama Judicial del Poder Público");
    if (vars.court_city) lines.push(vars.court_city);
  }

  lines.push("");
  lines.push("Ref: Memorial de Impulso Procesal");

  if (vars.radicado) {
    lines.push(`Radicado: ${vars.radicado}`);
  } else {
    lines.push(`Proceso: ${vars.process_type}`);
  }

  lines.push(`Demandante: ${vars.plaintiff_names}`);
  lines.push(`Demandado: ${vars.defendant_names}`);
  lines.push("");
  lines.push("Respetado(a) señor(a) Juez:");
  lines.push("");

  return lines.join("\n");
}

function buildFooter(vars: MemorialVariables): string {
  const lines = [
    "",
    "Del señor(a) Juez, atentamente,",
    "",
    "",
    "",
    vars.lawyer_full_name || "{{lawyer_full_name}}",
    `C.C. ${vars.lawyer_cedula || "{{lawyer_cedula}}"}`,
    `T.P. ${vars.lawyer_tarjeta_profesional || "{{lawyer_tarjeta_profesional}}"}`,
  ];
  if (vars.lawyer_litigation_email) lines.push(vars.lawyer_litigation_email);
  lines.push(`Apoderado(a) judicial de la parte ${vars.represented_side}`);
  return lines.join("\n");
}

// ─── Body Templates ─────────────────────────────────────

const BODY_TEMPLATES: Record<MemorialType, string> = {
  impulso_general: `{{lawyer_full_name}}, identificado(a) con cédula de ciudadanía No. {{lawyer_cedula}}, portador(a) de la Tarjeta Profesional No. {{lawyer_tarjeta_profesional}}, actuando como apoderado(a) judicial de la parte {{represented_side}} en el proceso de la referencia, respetuosamente me permito solicitar a su Despacho se sirva impulsar el trámite del presente proceso, de conformidad con lo establecido en el artículo 121 del Código General del Proceso y en concordancia con el principio de celeridad procesal consagrado en el artículo 4 ibídem.

Lo anterior, teniendo en cuenta que a la fecha no se ha proferido providencia alguna que permita el avance del proceso, pese a encontrarse las condiciones procesales para ello.

Respetuosamente solicito a su Despacho se sirva dar el correspondiente impulso procesal al asunto de la referencia.`,

  fijacion_audiencia: `{{lawyer_full_name}}, identificado(a) con cédula de ciudadanía No. {{lawyer_cedula}}, portador(a) de la Tarjeta Profesional No. {{lawyer_tarjeta_profesional}}, actuando como apoderado(a) judicial de la parte {{represented_side}} en el proceso de la referencia, respetuosamente me permito solicitar a su Despacho se sirva fijar fecha y hora para la celebración de la {{audience_type}}, toda vez que se han cumplido los presupuestos procesales necesarios para su realización.

Lo anterior, de conformidad con los artículos 121 y {{legal_article}} del Código General del Proceso, y en atención al principio de celeridad y oralidad que rige el procedimiento civil colombiano.`,

  pronunciamiento_pendiente: `{{lawyer_full_name}}, identificado(a) con cédula de ciudadanía No. {{lawyer_cedula}}, portador(a) de la Tarjeta Profesional No. {{lawyer_tarjeta_profesional}}, actuando como apoderado(a) judicial de la parte {{represented_side}} en el proceso de la referencia, respetuosamente me permito solicitar a su Despacho se sirva pronunciarse sobre el {{pending_document_type}} presentado el día {{pending_document_date}}, respecto del cual a la fecha no se ha emitido providencia alguna.

Lo anterior, de conformidad con el artículo 121 del Código General del Proceso, que establece los términos que tiene el Despacho para proferir las providencias correspondientes.`,

  vencimiento_terminos: `{{lawyer_full_name}}, identificado(a) con cédula de ciudadanía No. {{lawyer_cedula}}, portador(a) de la Tarjeta Profesional No. {{lawyer_tarjeta_profesional}}, actuando como apoderado(a) judicial de la parte {{represented_side}} en el proceso de la referencia, respetuosamente me permito poner de presente ante su Despacho que los términos procesales establecidos en el Código General del Proceso para {{specific_action}} se encuentran vencidos, toda vez que {{reason_for_delay}}.

De conformidad con el artículo 121 del Código General del Proceso, las actuaciones procesales deben surtirse dentro de los términos legales. El incumplimiento de los términos puede dar lugar a las consecuencias previstas en el artículo 121 ibídem.

Respetuosamente solicito a su Despacho se sirva dar cumplimiento a los términos procesales y proferir la providencia correspondiente.`,

  impulso_tras_auto: `{{lawyer_full_name}}, identificado(a) con cédula de ciudadanía No. {{lawyer_cedula}}, portador(a) de la Tarjeta Profesional No. {{lawyer_tarjeta_profesional}}, actuando como apoderado(a) judicial de la parte {{represented_side}} en el proceso de la referencia, respetuosamente me permito informar que la parte demandada fue debidamente notificada del auto admisorio de la demanda, y a la fecha ya ha vencido el término de traslado de la demanda.

En consecuencia, solicito a su Despacho se sirva dar el impulso procesal correspondiente, procediendo a {{next_step}}, de conformidad con la etapa procesal en que se encuentra el proceso.`,

  notificacion_demandado: `{{lawyer_full_name}}, identificado(a) con cédula de ciudadanía No. {{lawyer_cedula}}, portador(a) de la Tarjeta Profesional No. {{lawyer_tarjeta_profesional}}, actuando como apoderado(a) judicial de la parte {{represented_side}} en el proceso de la referencia, respetuosamente me permito informar que se ha cumplido con el envío de la comunicación de que trata el artículo 291 del Código General del Proceso para efectos de la notificación personal del auto admisorio de la demanda al demandado.

Adjunto constancia del envío de dicha comunicación.

En consecuencia, solicito a su Despacho se sirva librar los oficios o tomar las medidas necesarias para perfeccionar la notificación al demandado en los términos del Código General del Proceso.`,

  decreto_pruebas: `{{lawyer_full_name}}, identificado(a) con cédula de ciudadanía No. {{lawyer_cedula}}, portador(a) de la Tarjeta Profesional No. {{lawyer_tarjeta_profesional}}, actuando como apoderado(a) judicial de la parte {{represented_side}} en el proceso de la referencia, respetuosamente me permito solicitar a su Despacho se sirva decretar y practicar las pruebas oportunamente solicitadas por esta parte, las cuales resultan pertinentes, conducentes y útiles para el esclarecimiento de los hechos objeto del litigio.

Lo anterior, de conformidad con los artículos 164 y siguientes del Código General del Proceso, y en atención al derecho fundamental al debido proceso y al acceso efectivo a la administración de justicia.`,

  solicitud_sentencia: `{{lawyer_full_name}}, identificado(a) con cédula de ciudadanía No. {{lawyer_cedula}}, portador(a) de la Tarjeta Profesional No. {{lawyer_tarjeta_profesional}}, actuando como apoderado(a) judicial de la parte {{represented_side}} en el proceso de la referencia, respetuosamente me permito solicitar a su Despacho se sirva proferir la sentencia correspondiente, toda vez que el proceso se encuentra en estado de dictar fallo, habiéndose agotado las etapas procesales previas.

Lo anterior, de conformidad con el artículo 121 del Código General del Proceso, que establece el deber del juez de dictar sentencia dentro de los términos legales.`,

  personalizado: `[Redacte aquí el cuerpo del memorial]`,
};

/**
 * Generate the full memorial text for a given type, variables, and extra fields.
 */
export function generateMemorialText(
  memorialType: MemorialType,
  vars: MemorialVariables,
  extras: Record<string, string> = {}
): string {
  const allVars = { ...vars, ...extras };

  // For fijacion_audiencia, compute legal_basis/legal_article from audience_type
  if (memorialType === "fijacion_audiencia" && extras.audience_type) {
    const { legal_basis, legal_article } = getLegalBasisForAudienceType(extras.audience_type);
    allVars.legal_basis = legal_basis;
    allVars.legal_article = legal_article;
  }

  const header = buildHeader(vars);
  const body = replaceVars(BODY_TEMPLATES[memorialType] || BODY_TEMPLATES.personalizado, allVars);
  const footer = buildFooter(vars);

  return header + body + "\n" + footer;
}

/**
 * Generate the memorial as HTML (for rich-text copy).
 */
export function generateMemorialHtml(
  memorialType: MemorialType,
  vars: MemorialVariables,
  extras: Record<string, string> = {}
): string {
  const text = generateMemorialText(memorialType, vars, extras);
  // Convert plain text to basic HTML paragraphs
  const paragraphs = text.split(/\n\n+/).map(p => {
    const lines = p.split("\n").map(l => {
      // Bold uppercase lines (judge name, lawyer name in footer)
      if (/^[A-ZÁÉÍÓÚÑ\s.]+$/.test(l.trim()) && l.trim().length > 3) {
        return `<strong>${l}</strong>`;
      }
      return l;
    });
    return `<p>${lines.join("<br/>")}</p>`;
  });
  return paragraphs.join("\n");
}
