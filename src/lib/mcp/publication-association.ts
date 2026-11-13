import { hasUnaccreditedAssociation } from "../publication-quality";
import { PRINTED_DATE_SELECT, printedDateEvidence } from "../printed-date-evidence";
/** Project only the existing UI quality flag, never the enclosing raw_data. */
export const PUBLICATION_ASSOCIATION_SELECT = `association_flag:raw_data->asociacion_no_acreditada,${PRINTED_DATE_SELECT}` as const;

const objectOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const bounded = (value: unknown, max = 240): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
const digits = (value: unknown): string | null =>
  typeof value === "string" && /^\d{23}$/.test(value) ? value : null;

/** Same truthy flag contract as EstadosTab/PublicacionesPpTab. Absence is NOT proof. */
export function publicationAssociation(row: Record<string, unknown>, workItemRadicado: unknown) {
  const flag = row.association_flag;
  const metadata = objectOf(flag);
  const { association_flag: _privateFlag, raw_data: _raw, printed_observations, ...publicRow } = row;
  const observations = printedDateEvidence(row.id, printed_observations);
  return {
    ...publicRow,
    ...(observations.length ? { cotejos_documentales: observations.map(o => ({
      fuente: "estado_pdf_archivado", articulo: o.source_article, sha256: o.original_sha256,
      url_original: o.source_url, pagina_desde: o.first_page, pagina_hasta: o.last_page,
      fijacion_impresa: o.printed_fixation, fijacion_registrada_al_cotejo: o.recorded_fixation,
      cotejado_en: o.observed_at, modifica_terminos: false, consulta_nueva_al_portal: false,
    })) } : {}),
    asociacion_no_acreditada: hasUnaccreditedAssociation(flag),
    calidad_asociacion: {
      estado: flag ? "no_acreditada" : "sin_alerta_registrada",
      acreditada: flag ? false : null,
      procedencia: flag ? "raw_data.asociacion_no_acreditada" : null,
      radicado_asunto: bounded(workItemRadicado, 23),
      // Never infer document identity from date/title or the stream suffix.
      radicado_documento: digits(metadata.radicado_documento),
      documento_id: typeof metadata.documento_id === "string" && /^[0-9a-f-]{36}$/i.test(metadata.documento_id)
        ? metadata.documento_id : null,
      fuente: bounded(metadata.fuente),
      articulo: bounded(metadata.articulo),
      marcado_en: bounded(metadata.marcado_en, 64),
      sha256_original_providencia: typeof metadata.sha256_original_providencia === "string"
        && /^[0-9a-f]{64}$/i.test(metadata.sha256_original_providencia)
        ? metadata.sha256_original_providencia : null,
    },
  };
}

/** Counts describe ONLY the returned page. Unflagged is not accredited. */
export function publicationPageSummary(rows: Record<string, unknown>[]) {
  const flagged = rows.filter((r) => r.asociacion_no_acreditada === true).length;
  return {
    alcance: "pagina_devuelta",
    registros_crudos: rows.length,
    asociacion_no_acreditada: flagged,
    sin_alerta_registrada: rows.length - flagged,
    registros_acreditados: null,
    ultimo_estado_acreditado: null,
    acreditacion_estado: "no_determinada_por_ausencia_de_alerta",
  };
}
