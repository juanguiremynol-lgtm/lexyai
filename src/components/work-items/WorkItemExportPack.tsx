/**
 * WorkItemExportPack — One-click export of work item summary + acts + estados + tasks
 * Starts with CSV/print view, extensible to PDF/DOCX later.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ensureValidSession } from "@/lib/supabase-query-guard";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileText, Printer, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import type { WorkItem } from "@/types/work-item";

// OWASP formula injection protection
function sanitizeCell(value: string): string {
  if (typeof value !== "string") return String(value ?? "");
  if (/^[=+\-@\t\r\n]/.test(value)) return "'" + value;
  return value;
}

interface ExportPackProps {
  workItem: WorkItem;
}

export function WorkItemExportPack({ workItem }: ExportPackProps) {
  const [isExporting, setIsExporting] = useState(false);

  const fetchExportData = async () => {
    await ensureValidSession();

    const [actsRes, estadosRes, tasksRes] = await Promise.all([
      supabase
        .from("work_item_acts")
        .select("description, act_date, source, act_type, despacho")
        .eq("work_item_id", workItem.id)
        .eq("is_archived", false)
        .order("act_date", { ascending: false }),
      supabase
        .from("work_item_publicaciones")
        .select("title, fecha_fijacion, fecha_desfijacion, source")
        .eq("work_item_id", workItem.id)
        .order("fecha_fijacion", { ascending: false }),
      supabase
        .from("work_item_tasks")
        .select("title, description, status, priority, due_date, created_at")
        .eq("work_item_id", workItem.id)
        .order("created_at", { ascending: false }),
    ]);

    return {
      acts: actsRes.data || [],
      estados: estadosRes.data || [],
      tasks: tasksRes.data || [],
    };
  };

  const handleCSVExport = async () => {
    setIsExporting(true);
    try {
      const { acts, estados, tasks } = await fetchExportData();

      const lines: string[] = [];
      const sep = ",";

      // Summary section
      lines.push("=== RESUMEN DEL PROCESO ===");
      lines.push(`Radicado${sep}${sanitizeCell(workItem.radicado || "—")}`);
      lines.push(`Título${sep}${sanitizeCell(workItem.title || "—")}`);
      lines.push(`Tipo${sep}${sanitizeCell(workItem.workflow_type || "—")}`);
      lines.push(`Etapa${sep}${sanitizeCell(workItem.stage || "—")}`);
      lines.push(`Estado${sep}${sanitizeCell(workItem.status || "—")}`);
      lines.push(`Autoridad${sep}${sanitizeCell(workItem.authority_name || "—")}`);
      lines.push(`Ciudad${sep}${sanitizeCell(workItem.authority_city || "—")}`);
      lines.push(`Demandantes${sep}${sanitizeCell(workItem.demandantes || "—")}`);
      lines.push(`Demandados${sep}${sanitizeCell(workItem.demandados || "—")}`);
      lines.push("");

      // Actuaciones
      lines.push("=== ACTUACIONES ===");
      lines.push(`Fecha${sep}Descripción${sep}Tipo${sep}Fuente${sep}Despacho`);
      for (const act of acts) {
        lines.push([
          sanitizeCell(act.act_date || "—"),
          sanitizeCell(act.description || "—"),
          sanitizeCell(act.act_type || "—"),
          sanitizeCell(act.source || "—"),
          sanitizeCell(act.despacho || "—"),
        ].join(sep));
      }
      lines.push("");

      // Estados
      lines.push("=== ESTADOS / PUBLICACIONES ===");
      lines.push(`Fecha Fijación${sep}Fecha Desfijación${sep}Título${sep}Fuente`);
      for (const est of estados) {
        lines.push([
          sanitizeCell((est as any).fecha_fijacion || "—"),
          sanitizeCell((est as any).fecha_desfijacion || "—"),
          sanitizeCell((est as any).title || "—"),
          sanitizeCell((est as any).source || "—"),
        ].join(sep));
      }
      lines.push("");

      // Tasks
      lines.push("=== TAREAS ===");
      lines.push(`Título${sep}Estado${sep}Prioridad${sep}Fecha Límite${sep}Descripción`);
      for (const task of tasks) {
        lines.push([
          sanitizeCell(task.title || "—"),
          sanitizeCell(task.status || "—"),
          sanitizeCell(task.priority || "—"),
          sanitizeCell(task.due_date || "—"),
          sanitizeCell(task.description || "—"),
        ].join(sep));
      }

      // Download
      const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `proceso-${workItem.radicado || workItem.id.slice(0, 8)}-${format(new Date(), "yyyyMMdd")}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      track(ANALYTICS_EVENTS.WORK_ITEM_EXPORT_CLICKED, { export_type: "csv" });
      toast.success("Exportación CSV descargada");
    } catch (err) {
      toast.error("Error al exportar");
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrintView = async () => {
    setIsExporting(true);
    try {
      const { acts, estados, tasks } = await fetchExportData();

      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        toast.error("Permite ventanas emergentes para imprimir");
        return;
      }

      const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Proceso ${workItem.radicado || ""}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 24px; font-size: 12px; color: #1a1a1a; }
    h1 { font-size: 18px; border-bottom: 2px solid #333; padding-bottom: 8px; }
    h2 { font-size: 14px; margin-top: 24px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; }
    .meta dt { font-weight: 600; color: #666; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; }
    .alta { background: #fee2e2; color: #991b1b; }
    .media { background: #fef3c7; color: #92400e; }
    .baja { background: #dbeafe; color: #1e40af; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>📋 ${workItem.title || workItem.radicado || "Proceso"}</h1>
  <dl class="meta">
    <dt>Radicado</dt><dd>${workItem.radicado || "—"}</dd>
    <dt>Tipo</dt><dd>${workItem.workflow_type || "—"}</dd>
    <dt>Etapa</dt><dd>${workItem.stage || "—"}</dd>
    <dt>Estado</dt><dd>${workItem.status || "—"}</dd>
    <dt>Autoridad</dt><dd>${workItem.authority_name || "—"}</dd>
    <dt>Ciudad</dt><dd>${workItem.authority_city || "—"}</dd>
    <dt>Demandantes</dt><dd>${workItem.demandantes || "—"}</dd>
    <dt>Demandados</dt><dd>${workItem.demandados || "—"}</dd>
  </dl>

  <h2>⚖️ Actuaciones (${acts.length})</h2>
  <table>
    <thead><tr><th>Fecha</th><th>Descripción</th><th>Tipo</th><th>Fuente</th></tr></thead>
    <tbody>
      ${acts.map(a => `<tr><td>${a.act_date || "—"}</td><td>${a.description || "—"}</td><td>${a.act_type || "—"}</td><td>${a.source || "—"}</td></tr>`).join("")}
      ${acts.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:#999">Sin actuaciones registradas</td></tr>' : ""}
    </tbody>
  </table>

  <h2>📰 Estados / Publicaciones (${estados.length})</h2>
  <table>
    <thead><tr><th>Fijación</th><th>Desfijación</th><th>Título</th><th>Fuente</th></tr></thead>
    <tbody>
      ${estados.map((e: any) => `<tr><td>${e.fecha_fijacion || "—"}</td><td>${e.fecha_desfijacion || "—"}</td><td>${e.title || "—"}</td><td>${e.source || "—"}</td></tr>`).join("")}
      ${estados.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:#999">Sin estados registrados</td></tr>' : ""}
    </tbody>
  </table>

  <h2>✅ Tareas (${tasks.length})</h2>
  <table>
    <thead><tr><th>Título</th><th>Estado</th><th>Prioridad</th><th>Fecha Límite</th></tr></thead>
    <tbody>
      ${tasks.map(t => `<tr><td>${t.title || "—"}</td><td>${t.status || "—"}</td><td><span class="badge ${(t.priority || "").toLowerCase()}">${t.priority || "—"}</span></td><td>${t.due_date || "—"}</td></tr>`).join("")}
      ${tasks.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:#999">Sin tareas</td></tr>' : ""}
    </tbody>
  </table>

  <p style="margin-top:24px;font-size:10px;color:#999">Generado por Atenia el ${format(new Date(), "d MMMM yyyy, HH:mm", { locale: es })}</p>
  <script>window.print();</script>
</body>
</html>`;

      printWindow.document.write(html);
      printWindow.document.close();

      track(ANALYTICS_EVENTS.WORK_ITEM_EXPORT_CLICKED, { export_type: "print" });
    } catch (err) {
      toast.error("Error al generar vista de impresión");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isExporting}>
          {isExporting ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-1.5" />
          )}
          Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleCSVExport}>
          <FileText className="h-4 w-4 mr-2" />
          Descargar CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handlePrintView}>
          <Printer className="h-4 w-4 mr-2" />
          Vista de impresión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
