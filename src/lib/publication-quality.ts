/** Existing EstadosTab/PublicacionesPpTab contract: a truthy flag excludes
 * procedural attribution, never history. Absence alone does not prove it. */
export function hasUnaccreditedAssociation(flag: unknown): boolean {
  return Boolean(flag);
}

export function proceduralPublicationEvents(rows: Array<{
  is_archived?: boolean | null;
  association_flag?: unknown;
  fecha_fijacion?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  title?: string | null;
  annotation?: string | null;
  fecha_providencia?: string | null;
}>) {
  return rows.flatMap((p) => {
    if (p.is_archived || hasUnaccreditedAssociation(p.association_flag)) return [];
    const at = p.fecha_fijacion ?? p.published_at ?? p.created_at;
    if (!at) return [];
    return [{ at, text: `${p.title ?? ""} ${p.annotation ?? ""}`, source: "ESTADO" as const,
      docDate: p.fecha_providencia ?? null }];
  });
}