/**
 * ActuacionesTable — dense Icarus-style table used by every workflow
 * (CGP / CPACA / PENAL / LABORAL / TUTELA) to render actuaciones.
 *
 * Presentation-only: rows are already fetched and merged by the parent
 * tab (ActsTab / PublicacionesPpTab). No hooks, no queries, no fingerprint
 * logic here.
 */

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, Table2, ExternalLink, HardDrive, Download, Eye } from "lucide-react";
import type { WorkItemAct } from "./WorkItemActCard";

// ─── helpers ────────────────────────────────────────────────────────────────

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

function pickAnotacion(act: WorkItemAct): string {
  const raw = act.raw_data as Record<string, unknown> | null | undefined;
  const rawAnotacion =
    (raw?.anotacion as string | undefined) ||
    (raw?.annotation as string | undefined) ||
    (raw?.Anotacion as string | undefined);

  const desc = act.description || "";
  const sepIdx = desc.indexOf(" - ");
  const parsedAnnotation =
    sepIdx > 0 && sepIdx < 80 ? desc.substring(sepIdx + 3).trim() : null;

  return (
    (rawAnotacion?.trim() ? rawAnotacion.trim() : "") ||
    parsedAnnotation ||
    (act.event_summary && act.event_summary !== act.description
      ? act.event_summary
      : "") ||
    ""
  );
}

function pickActionType(act: WorkItemAct): string {
  const desc = act.description || "";
  const sepIdx = desc.indexOf(" - ");
  if (sepIdx > 0 && sepIdx < 80) return desc.substring(0, sepIdx).trim();
  return desc || "—";
}

function pickInstancia(act: WorkItemAct): string {
  const raw = act.raw_data as Record<string, unknown> | null | undefined;
  return String(act.instancia || (raw?.instancia as string | undefined) || "");
}

function pickFechaRegistro(act: WorkItemAct): string {
  const raw = act.raw_data as Record<string, unknown> | null | undefined;
  return String(
    act.fecha_registro_source || (raw?.fecha_registro as string | undefined) || "",
  );
}

function pickIniciaTermino(act: WorkItemAct): string {
  const raw = act.raw_data as Record<string, unknown> | null | undefined;
  return String(
    act.inicia_termino ||
      (raw?.inicia_termino as string | undefined) ||
      (raw?.fecha_inicia_termino as string | undefined) ||
      "",
  );
}

function sourceChipClass(src: string): string {
  const s = (src || "").toLowerCase();
  if (s.includes("samai"))
    return "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30";
  if (s.includes("cpnu"))
    return "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30";
  if (s === "pp" || s.includes("publicaciones"))
    return "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30";
  if (s.includes("tutela"))
    return "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30";
  return "bg-muted text-muted-foreground border-border";
}

// ─── document buttons ──────────────────────────────────────────────────────

interface SamaiAnexoDocumento {
  urlVer?: string | null;
  urlDescarga?: string | null;
  descripcion?: string | null;
}

function extractSamaiAttachments(act: WorkItemAct): SamaiAnexoDocumento[] {
  const raw = act.raw_data as Record<string, unknown> | null | undefined;
  const isSamai =
    act.source === "samai" ||
    (act.sources?.some((s) => s?.toLowerCase() === "samai") ?? false);
  if (!isSamai || !raw) return [];
  const arr = raw.anexos_documentos;
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (x): x is SamaiAnexoDocumento =>
      !!x && typeof x === "object" && (("urlVer" in x) || ("urlDescarga" in x)),
  );
}

function DefaultDocButtons({ act }: { act: WorkItemAct }) {
  const raw = act.raw_data as Record<string, unknown> | null | undefined;
  const autoUrl = raw?.gcs_url_auto as string | undefined;
  const tablaUrl = raw?.gcs_url_tabla as string | undefined;
  const pdfIndividualUrl = raw?.pdf_individual_url as string | undefined;
  const proxyPdfUrl = raw?.pdf_url as string | undefined;
  const samai = extractSamaiAttachments(act);
  const clasificada = (raw?.estado as string | undefined)?.toUpperCase() === "CLASIFICADA";

  const items: Array<{ href: string; icon: JSX.Element; label: string; title?: string }> = [];
  if (autoUrl?.trim())
    items.push({ href: autoUrl, icon: <FileText className="h-3 w-3" />, label: "Auto" });
  if (tablaUrl?.trim())
    items.push({ href: tablaUrl, icon: <Table2 className="h-3 w-3" />, label: "Tabla" });
  if (pdfIndividualUrl?.trim())
    items.push({
      href: pdfIndividualUrl,
      icon: <ExternalLink className="h-3 w-3" />,
      label: "PDF",
    });
  if (!items.length && proxyPdfUrl?.trim())
    items.push({
      href: proxyPdfUrl,
      icon: <ExternalLink className="h-3 w-3" />,
      label: "PDF",
    });
  if (!clasificada) {
    for (const doc of samai) {
      if (doc.urlVer)
        items.push({
          href: doc.urlVer,
          icon: <Eye className="h-3 w-3" />,
          label: "Ver",
          title: doc.descripcion || undefined,
        });
      if (doc.urlDescarga)
        items.push({
          href: doc.urlDescarga,
          icon: <Download className="h-3 w-3" />,
          label: "Descargar",
          title: doc.descripcion || undefined,
        });
    }
  }

  if (!items.length && clasificada) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300">
        Clasificado
      </span>
    );
  }
  if (!items.length) return <span className="text-muted-foreground/40">—</span>;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {items.map((it, i) => (
        <a
          key={i}
          href={it.href}
          target="_blank"
          rel="noopener noreferrer"
          title={it.title || it.label}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border border-border/60 hover:bg-muted/60 text-foreground/80 hover:text-foreground transition-colors"
        >
          {it.icon}
          <span>{it.label}</span>
        </a>
      ))}
    </div>
  );
}

// ─── main table ─────────────────────────────────────────────────────────────

interface ActuacionesTableProps {
  acts: WorkItemAct[];
  renderDocs?: (act: WorkItemAct) => React.ReactNode;
}

export function ActuacionesTable({ acts, renderDocs }: ActuacionesTableProps) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <Table className="text-sm">
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="h-9 px-3 whitespace-nowrap w-[110px]">
                Fecha
              </TableHead>
              <TableHead className="h-9 px-3 min-w-[180px]">Actuación</TableHead>
              <TableHead className="h-9 px-3 min-w-[320px]">Anotación</TableHead>
              <TableHead className="h-9 px-3 whitespace-nowrap w-[80px]">
                Instancia
              </TableHead>
              <TableHead className="h-9 px-3 whitespace-nowrap w-[120px]">
                F. registro
              </TableHead>
              <TableHead className="h-9 px-3 whitespace-nowrap w-[120px]">
                Inicia término
              </TableHead>
              <TableHead className="h-9 px-3 whitespace-nowrap w-[140px]">
                Documento
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {acts.map((act) => {
              const anot = pickAnotacion(act);
              const actionType = pickActionType(act);
              const inst = pickInstancia(act);
              const freg = pickFechaRegistro(act);
              const inicia = pickIniciaTermino(act);
              const sources =
                act.sources && act.sources.length > 0
                  ? act.sources
                  : act.source
                    ? [act.source]
                    : [];

              return (
                <TableRow key={act.id} className="align-top">
                  <TableCell className="p-3 whitespace-nowrap text-xs text-foreground/90 font-mono">
                    {act.act_date ? (
                      fmt(act.act_date)
                    ) : (
                      <span className="italic text-muted-foreground/60">—</span>
                    )}
                  </TableCell>
                  <TableCell className="p-3 align-top">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-foreground leading-snug">
                        {actionType}
                      </span>
                      <div className="flex flex-wrap items-center gap-1">
                        {sources.map((s) => (
                          <span
                            key={s}
                            className={cn(
                              "inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium uppercase tracking-wide",
                              sourceChipClass(s),
                            )}
                          >
                            {s}
                          </span>
                        ))}
                        {act.changed_at && (
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-medium"
                            title="Registro modificado"
                          >
                            ✏️ Modificada
                          </span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="p-3 align-top">
                    {anot ? (
                      <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap break-words">
                        {anot}
                      </p>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                  <TableCell className="p-3 whitespace-nowrap text-xs text-foreground/80 font-mono">
                    {inst || <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell className="p-3 whitespace-nowrap text-xs text-foreground/80 font-mono">
                    {freg ? fmt(freg) : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell className="p-3 whitespace-nowrap text-xs text-foreground/80 font-mono">
                    {inicia ? (
                      fmt(inicia)
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                  <TableCell className="p-3 align-top">
                    {renderDocs ? renderDocs(act) : <DefaultDocButtons act={act} />}
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

// Named export for the storage-aware icon used by PP tab renderDocs
export { HardDrive as StorageIcon };