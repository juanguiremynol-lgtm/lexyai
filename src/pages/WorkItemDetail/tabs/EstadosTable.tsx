/**
 * EstadosTable — dense Icarus-style table used by every workflow to render
 * "estados electrónicos" (publicaciones procesales).
 *
 * Presentation-only: rows come pre-merged from the parent tab. Clicking the
 * filename opens the associated PDF via whatever URL the row already carries
 * (storage-signed via edge fn is handled by the parent's onOpen callback).
 */

import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, ExternalLink, Table2 } from "lucide-react";

export interface EstadoRow {
  key: string;
  fuente: string;
  title: string;
  /** Full ruling body — rendered under the title when present. */
  descripcion?: string | null;
  despacho?: string | null;
  tipo_documento?: string | null;
  fecha?: string | null;
  gcs_url_auto?: string | null;
  gcs_url_tabla?: string | null;
  pdf_url?: string | null;
  // optional: if provided, clicking the filename calls this instead of the
  // raw pdf_url — used by PP tab to route through get-estado-attachment-url.
  onOpenFile?: () => void;
}

function parseFlexibleDate(input: string): Date | null {
  if (!input) return null;
  const s = String(input).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmy) {
    const [, dd, mm, yy] = dmy;
    let year = Number(yy);
    if (year < 100) year += 2000;
    const dt = new Date(year, Number(mm) - 1, Number(dd));
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

function fmt(dateStr?: string | null): string {
  if (!dateStr) return "";
  const d = parseFlexibleDate(String(dateStr));
  if (!d) return String(dateStr);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function fuenteChipClass(f: string): string {
  const s = (f || "").toUpperCase();
  if (s.includes("SAMAI"))
    return "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30";
  if (s === "PP" || s.includes("PUBLICACIONES"))
    return "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30";
  return "bg-muted text-muted-foreground border-border";
}

function fuenteLabel(f: string): string {
  const s = (f || "").toUpperCase();
  if (s === "PP" || s.includes("PUBLICACIONES")) return "Rama Judicial";
  if (s.includes("SAMAI")) return "CPACA";
  return f || "—";
}

export function EstadosTable({ rows }: { rows: EstadoRow[] }) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <Table className="text-sm">
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="h-9 px-3 min-w-[280px]">
                Nombre del archivo
              </TableHead>
              <TableHead className="h-9 px-3 min-w-[200px]">Despacho</TableHead>
              <TableHead className="h-9 px-3 min-w-[180px]">Tipo de documento</TableHead>
              <TableHead className="h-9 px-3 whitespace-nowrap w-[130px]">
                Encontrado el
              </TableHead>
              <TableHead className="h-9 px-3 whitespace-nowrap w-[140px]">
                Documento
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const openFile = () => {
                if (r.onOpenFile) {
                  r.onOpenFile();
                  return;
                }
                const url = r.pdf_url || r.gcs_url_auto || r.gcs_url_tabla;
                if (url) window.open(url, "_blank", "noopener,noreferrer");
              };
              const hasAny = !!(r.onOpenFile || r.pdf_url || r.gcs_url_auto || r.gcs_url_tabla);
              return (
                <TableRow key={r.key} className="align-top">
                  <TableCell className="p-3 align-top">
                    <div className="flex flex-col gap-1">
                      {hasAny ? (
                        <button
                          type="button"
                          onClick={openFile}
                          className="text-left font-medium text-primary hover:underline leading-snug break-words"
                        >
                          {r.title || "Sin descripción"}
                        </button>
                      ) : (
                        <span className="font-medium text-foreground leading-snug break-words">
                          {r.title || "Sin descripción"}
                        </span>
                      )}
                      {r.descripcion && r.descripcion.trim() && r.descripcion.trim() !== r.title?.trim() && (
                        <p className="text-xs text-foreground/75 leading-snug whitespace-pre-wrap break-words">
                          {r.descripcion.trim()}
                        </p>
                      )}
                      <span
                        className={cn(
                          "inline-flex w-fit items-center px-1.5 py-0.5 rounded border text-[10px] font-medium uppercase tracking-wide",
                          fuenteChipClass(r.fuente),
                        )}
                      >
                        {fuenteLabel(r.fuente)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="p-3 align-top text-sm text-foreground/85 break-words">
                    {r.despacho || <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell className="p-3 align-top text-sm text-foreground/85 break-words">
                    {r.tipo_documento || (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                  <TableCell className="p-3 whitespace-nowrap text-xs text-foreground/80 font-mono">
                    {r.fecha ? fmt(r.fecha) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                  <TableCell className="p-3 align-top">
                    <div className="flex items-center gap-1 flex-wrap">
                      {r.gcs_url_auto && (
                        <a
                          href={r.gcs_url_auto}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border border-border/60 hover:bg-muted/60 transition-colors"
                        >
                          <FileText className="h-3 w-3" /> Auto
                        </a>
                      )}
                      {r.gcs_url_tabla && (
                        <a
                          href={r.gcs_url_tabla}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border border-border/60 hover:bg-muted/60 transition-colors"
                        >
                          <Table2 className="h-3 w-3" /> Tabla
                        </a>
                      )}
                      {r.pdf_url && !r.onOpenFile && (
                        <a
                          href={r.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border border-border/60 hover:bg-muted/60 transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" /> PDF
                        </a>
                      )}
                      {!r.gcs_url_auto && !r.gcs_url_tabla && !r.pdf_url && !r.onOpenFile && (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}