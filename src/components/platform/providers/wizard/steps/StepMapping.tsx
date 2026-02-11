/**
 * Step 5 — Mapping & Normalization Preview
 * Left: mapping spec + validation. Right: DataPartitionView + AI explain button.
 */

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, ArrowLeftRight, CheckCircle2, Info, Copy, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DataPartitionView } from "../DataPartitionView";
import { supabase } from "@/integrations/supabase/client";
import type { WizardConnector } from "../WizardTypes";

interface StepMappingProps {
  connector: WizardConnector;
  onNext: () => void;
  partitionReport?: {
    acts?: { ingested: number; extras_fields: number; missing_required: string[] };
    pubs?: { ingested: number; extras_fields: number; missing_required: string[] };
    unknown_sections?: string[];
  } | null;
}

const CANONICAL_ACTS_SCHEMA = [
  { field: "work_item_id", type: "uuid", required: true, desc: "FK a work_items" },
  { field: "description", type: "text", required: true, desc: "Anotación + actuación concatenadas" },
  { field: "event_summary", type: "text", required: false, desc: "Preview truncado para UI" },
  { field: "event_date", type: "date", required: true, desc: "Fecha del acto judicial" },
  { field: "source_platform", type: "text", required: true, desc: "CPNU, SAMAI, EXTERNAL, etc." },
  { field: "scrape_date", type: "timestamptz", required: true, desc: "Cuándo se obtuvo el dato" },
  { field: "raw_data", type: "jsonb", required: true, desc: "Payload completo del proveedor" },
  { field: "hash_fingerprint", type: "text", required: true, desc: "Dedup hash" },
];

const CANONICAL_PUBS_SCHEMA = [
  { field: "work_item_id", type: "uuid", required: true, desc: "FK a work_items" },
  { field: "description", type: "text", required: true, desc: "Descripción de la publicación" },
  { field: "pub_date", type: "date", required: true, desc: "Fecha de publicación" },
  { field: "source_platform", type: "text", required: true, desc: "PUBLICACIONES, EXTERNAL, etc." },
  { field: "raw_data", type: "jsonb", required: true, desc: "Payload del proveedor" },
  { field: "hash_fingerprint", type: "text", required: true, desc: "Dedup hash" },
];

export function StepMapping({ connector, onNext, partitionReport }: StepMappingProps) {
  const [isExplaining, setIsExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);

  const copySchema = (schema: typeof CANONICAL_ACTS_SCHEMA, label: string) => {
    navigator.clipboard.writeText(JSON.stringify(schema, null, 2));
    toast.success(`Esquema ${label} copiado`);
  };

  const explainPartition = useCallback(async () => {
    setIsExplaining(true);
    try {
      // Build a structural summary (no raw payload body)
      const structuralSummary = partitionReport
        ? {
            acts_ingested: partitionReport.acts?.ingested ?? 0,
            acts_extras: partitionReport.acts?.extras_fields ?? 0,
            acts_missing: partitionReport.acts?.missing_required ?? [],
            pubs_ingested: partitionReport.pubs?.ingested ?? 0,
            pubs_extras: partitionReport.pubs?.extras_fields ?? 0,
            pubs_missing: partitionReport.pubs?.missing_required ?? [],
            unknown_sections: partitionReport.unknown_sections ?? [],
          }
        : { note: "No E2E run yet" };

      const { data, error } = await supabase.functions.invoke("provider-wizard-ai-guide", {
        body: {
          mode: "PLATFORM",
          step_id: "mapping",
          wizard_state: {
            connector: {
              name: connector.name,
              capabilities: connector.capabilities,
              schema_version: connector.schema_version,
            },
          },
          question: `Explain the data partition for this connector. Structural summary: ${JSON.stringify(structuralSummary)}. Where does each type of data go? What tables are used and why?`,
        },
      });

      if (error) throw error;
      setExplanation(data?.explanation || "Sin explicación disponible.");
    } catch {
      toast.error("No se pudo obtener la explicación AI");
    } finally {
      setIsExplaining(false);
    }
  }, [connector, partitionReport]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Mapping spec + validation */}
      <div className="space-y-5">
        <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
          <ArrowLeftRight className="h-5 w-5 text-primary" />
          Mapping & Normalización
        </h2>

        <div className="flex items-start gap-2 text-xs bg-primary/5 border border-primary/20 rounded-lg p-3">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
          <span className="text-foreground/80">
            El proveedor debe emitir datos conformes al esquema canónico <strong>v1</strong>. No se requieren cambios de esquema por proveedor — la normalización se maneja por configuración del conector.
          </span>
        </div>

        {/* ACTS Schema */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              Esquema: <Badge variant="outline">ACTUACIONES</Badge>
            </h3>
            <Button size="sm" variant="ghost" onClick={() => copySchema(CANONICAL_ACTS_SCHEMA, "ACTS")}>
              <Copy className="h-3 w-3 mr-1" /> JSON
            </Button>
          </div>
          <div className="border border-border/50 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30 border-b border-border/50">
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Campo</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Tipo</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Req</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Descripción</th>
                </tr>
              </thead>
              <tbody>
                {CANONICAL_ACTS_SCHEMA.map((f) => (
                  <tr key={f.field} className="border-b border-border/30 last:border-0">
                    <td className="px-3 py-1.5 font-mono text-foreground">{f.field}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{f.type}</td>
                    <td className="px-3 py-1.5">{f.required ? <CheckCircle2 className="h-3 w-3 text-primary" /> : "—"}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{f.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* PUBS Schema */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              Esquema: <Badge variant="outline">PUBLICACIONES</Badge>
            </h3>
            <Button size="sm" variant="ghost" onClick={() => copySchema(CANONICAL_PUBS_SCHEMA, "PUBS")}>
              <Copy className="h-3 w-3 mr-1" /> JSON
            </Button>
          </div>
          <div className="border border-border/50 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30 border-b border-border/50">
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Campo</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Tipo</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Req</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Descripción</th>
                </tr>
              </thead>
              <tbody>
                {CANONICAL_PUBS_SCHEMA.map((f) => (
                  <tr key={f.field} className="border-b border-border/30 last:border-0">
                    <td className="px-3 py-1.5 font-mono text-foreground">{f.field}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{f.type}</td>
                    <td className="px-3 py-1.5">{f.required ? <CheckCircle2 className="h-3 w-3 text-primary" /> : "—"}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{f.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <span className="text-sm text-foreground/80">
            Conector <strong>{connector.name}</strong> usa schema <strong>{connector.schema_version}</strong> — compatible con esquema canónico v1.
          </span>
        </div>

        <div className="flex justify-end">
          <Button onClick={onNext} className="gap-2">
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Right: DataPartitionView + AI explain */}
      <div className="space-y-4">
        <DataPartitionView partitionReport={partitionReport} />

        <div className="space-y-2">
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-2"
            onClick={explainPartition}
            disabled={isExplaining}
          >
            {isExplaining ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Explicar esta partición
          </Button>

          {explanation && (
            <div className="text-xs bg-primary/5 border border-primary/20 rounded-lg p-3 text-foreground/80 leading-relaxed">
              {explanation}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
