/**
 * HearingDigestExport — Export hearing summary as DOCX
 */
import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileDown, Loader2 } from "lucide-react";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from "docx";
import { saveAs } from "file-saver";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { WorkItemHearing } from "@/hooks/use-work-item-hearings-v2";
import { HEARING_STATUS_LABELS } from "@/hooks/use-work-item-hearings-v2";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  hearings: WorkItemHearing[];
  workItem: {
    id: string;
    organization_id?: string;
    numero_radicado?: string;
    parties_summary?: string;
    despacho?: string;
    workflow_type?: string;
  };
}

export function HearingDigestExport({ open, onOpenChange, hearings, workItem }: Props) {
  const [exporting, setExporting] = useState(false);

  const heldHearings = hearings.filter(h => h.status === "held");

  const handleExport = async () => {
    setExporting(true);
    try {
      const sections: Paragraph[] = [];

      // Title
      sections.push(new Paragraph({
        children: [new TextRun({ text: "RESUMEN DE AUDIENCIAS", bold: true, size: 32, font: "Arial" })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }));

      // Work item info
      if (workItem.numero_radicado) {
        sections.push(new Paragraph({
          children: [
            new TextRun({ text: "Radicado: ", bold: true, size: 22, font: "Arial" }),
            new TextRun({ text: workItem.numero_radicado, size: 22, font: "Arial" }),
          ],
          spacing: { after: 80 },
        }));
      }
      if (workItem.despacho) {
        sections.push(new Paragraph({
          children: [
            new TextRun({ text: "Despacho: ", bold: true, size: 22, font: "Arial" }),
            new TextRun({ text: workItem.despacho, size: 22, font: "Arial" }),
          ],
          spacing: { after: 80 },
        }));
      }
      if (workItem.parties_summary) {
        sections.push(new Paragraph({
          children: [
            new TextRun({ text: "Partes: ", bold: true, size: 22, font: "Arial" }),
            new TextRun({ text: workItem.parties_summary, size: 22, font: "Arial" }),
          ],
          spacing: { after: 80 },
        }));
      }

      sections.push(new Paragraph({
        children: [new TextRun({ text: `Total audiencias: ${hearings.length} (${heldHearings.length} celebradas)`, size: 20, font: "Arial", italics: true })],
        spacing: { after: 200 },
      }));

      // Separator
      sections.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "999999" } },
        spacing: { after: 200 },
      }));

      // Timeline overview
      sections.push(new Paragraph({
        text: "LÍNEA TEMPORAL",
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 120 },
      }));

      for (const h of hearings) {
        const name = h.custom_name || h.hearing_type?.short_name || "Audiencia";
        const dateStr = h.occurred_at || h.scheduled_at
          ? format(new Date(h.occurred_at || h.scheduled_at!), "d MMM yyyy", { locale: es })
          : "Sin fecha";
        const statusLabel = HEARING_STATUS_LABELS[h.status] || h.status;

        sections.push(new Paragraph({
          children: [
            new TextRun({ text: `• ${name}`, bold: true, size: 20, font: "Arial" }),
            new TextRun({ text: ` — ${statusLabel} — ${dateStr}`, size: 20, font: "Arial" }),
          ],
          spacing: { after: 60 },
        }));
      }

      sections.push(new Paragraph({ spacing: { after: 200 } }));

      // Detailed sections for held hearings
      if (heldHearings.length > 0) {
        sections.push(new Paragraph({
          text: "DETALLE POR AUDIENCIA",
          heading: HeadingLevel.HEADING_2,
          spacing: { after: 120 },
        }));

        for (const h of heldHearings) {
          const name = h.custom_name || h.hearing_type?.short_name || "Audiencia";
          const dateStr = h.occurred_at
            ? format(new Date(h.occurred_at), "d MMM yyyy, HH:mm", { locale: es })
            : "Sin fecha";

          sections.push(new Paragraph({
            text: name,
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 80 },
          }));

          sections.push(new Paragraph({
            children: [
              new TextRun({ text: `Fecha: ${dateStr}`, size: 20, font: "Arial" }),
              h.duration_minutes
                ? new TextRun({ text: ` | Duración: ${h.duration_minutes} min`, size: 20, font: "Arial" })
                : new TextRun({ text: "" }),
              h.modality
                ? new TextRun({ text: ` | Modalidad: ${h.modality}`, size: 20, font: "Arial" })
                : new TextRun({ text: "" }),
            ],
            spacing: { after: 80 },
          }));

          // Participants
          if (h.participants && h.participants.length > 0) {
            sections.push(new Paragraph({
              children: [new TextRun({ text: "Participantes:", bold: true, size: 20, font: "Arial" })],
              spacing: { after: 40 },
            }));
            for (const p of h.participants) {
              sections.push(new Paragraph({
                children: [new TextRun({ text: `  • ${p.role || "—"}: ${p.name || "—"}${p.entity ? ` (${p.entity})` : ""}`, size: 20, font: "Arial" })],
                spacing: { after: 20 },
              }));
            }
          }

          // Decisions
          if (h.decisions_summary) {
            sections.push(new Paragraph({
              children: [new TextRun({ text: "Decisiones:", bold: true, size: 20, font: "Arial" })],
              spacing: { before: 80, after: 40 },
            }));
            sections.push(new Paragraph({
              children: [new TextRun({ text: h.decisions_summary, size: 20, font: "Arial" })],
              spacing: { after: 80 },
            }));
          }

          // Notes
          if (h.notes_plain_text) {
            sections.push(new Paragraph({
              children: [new TextRun({ text: "Notas:", bold: true, size: 20, font: "Arial" })],
              spacing: { before: 80, after: 40 },
            }));
            for (const line of h.notes_plain_text.split("\n")) {
              sections.push(new Paragraph({
                children: [new TextRun({ text: line, size: 20, font: "Arial" })],
                spacing: { after: 20 },
              }));
            }
          }

          // Key moments
          if (h.key_moments && h.key_moments.length > 0) {
            sections.push(new Paragraph({
              children: [new TextRun({ text: "Momentos clave:", bold: true, size: 20, font: "Arial" })],
              spacing: { before: 80, after: 40 },
            }));
            for (const km of h.key_moments) {
              const typeLabel = km.type === "decision" ? "📌 Decisión" : km.type === "commitment" ? "⚡ Compromiso" : "💡 Destacado";
              sections.push(new Paragraph({
                children: [
                  new TextRun({ text: `  ${km.timestamp || ""} [${typeLabel}] `, bold: true, size: 20, font: "Arial" }),
                  new TextRun({ text: km.text || "", size: 20, font: "Arial" }),
                ],
                spacing: { after: 20 },
              }));
            }
          }

          // Separator between hearings
          sections.push(new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" } },
            spacing: { after: 120 },
          }));
        }
      }

      // Footer
      sections.push(new Paragraph({
        children: [new TextRun({
          text: `Generado por Andromeda Legal — ${format(new Date(), "d MMM yyyy, HH:mm", { locale: es })}`,
          size: 16, font: "Arial", italics: true, color: "999999",
        })],
        alignment: AlignmentType.RIGHT,
        spacing: { before: 200 },
      }));

      const doc = new Document({
        sections: [{ properties: {}, children: sections }],
      });

      const blob = await Packer.toBlob(doc);
      const filename = `Resumen_Audiencias_${workItem.numero_radicado || workItem.id}.docx`;
      saveAs(blob, filename);

      // Audit log
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user && workItem.organization_id) {
          await supabase.from("hearing_audit_log").insert([{
            organization_id: workItem.organization_id,
            user_id: user.id,
            action: "digest_exported" as any,
            work_item_id: workItem.id,
            detail: { format: "docx", hearings_count: hearings.length, held_count: heldHearings.length } as any,
          }]);
        }
      } catch { /* audit is best-effort */ }

      toast.success("Resumen exportado");
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Error al exportar: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="h-5 w-5" />
            Exportar Resumen de Audiencias
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Se generará un documento DOCX con el resumen cronológico de todas las audiencias del proceso.
          </p>
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Total:</span>{" "}
              <Badge variant="outline">{hearings.length} audiencias</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Celebradas:</span>{" "}
              <Badge variant="secondary">{heldHearings.length}</Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground italic">
            El resumen compila hechos y notas registradas. No genera análisis legal ni cita jurisprudencia.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileDown className="h-4 w-4 mr-1" />}
            {exporting ? "Generando..." : "Exportar DOCX"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
