import { formatCivilDate } from "@/lib/civil-date";
import { printedDateEvidence } from "@/lib/printed-date-evidence";

export function PrintedDateNotes({ publications }: {
  publications: Array<{ id: string; title: string | null; printed_observations?: unknown }>;
}) {
  const notes = publications.flatMap(p => printedDateEvidence(p.id, p.printed_observations));
  if (notes.length === 0) return null;
  return <section className="space-y-2 rounded-lg border bg-card p-4">
    <h3 className="font-semibold">Fijaciones impresas en el estado</h3>
    <p className="text-sm text-muted-foreground">La lectura del PDF archivado permite contrastar la fecha registrada. Los términos se consultan en su propia sección.</p>
    <ul className="space-y-2 text-sm">{notes.map(o => <li key={`${o.publication_id}-${o.original_sha256}-${o.first_page}-${o.last_page}`}>
      <strong>Estado del artículo {o.source_article}</strong> · Fijación impresa {formatCivilDate(o.printed_fixation)} · Fecha registrada {formatCivilDate(o.recorded_fixation)}.{" "}
      <a className="underline" href={`${o.source_url}#page=${o.first_page}`} target="_blank" rel="noopener noreferrer">PDF, {o.first_page === o.last_page ? `página ${o.first_page}` : `páginas ${o.first_page}–${o.last_page}`}</a>
      <details className="mt-1 text-xs text-muted-foreground"><summary>Huella del PDF y fecha de cotejo</summary>
        <span className="break-all">SHA-256 {o.original_sha256}</span> · {new Date(o.observed_at).toLocaleDateString("es-CO", {timeZone:"America/Bogota"})}
      </details>
    </li>)}</ul>
  </section>;
}
