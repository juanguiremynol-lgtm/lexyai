/** Project only the existing UI quality flag, never the enclosing raw_data. */
export const PUBLICATION_ASSOCIATION_SELECT = "association_flag:raw_data->asociacion_no_acreditada";

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
  const { association_flag: _privateFlag, raw_data: _raw, ...publicRow } = row;
  return {
    ...publicRow,
    asociacion_no_acreditada: Boolean(flag),
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