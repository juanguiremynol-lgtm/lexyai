/**
 * Step 5 — Mapping & Normalization Preview
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, ArrowLeftRight, CheckCircle2, Info, Copy } from "lucide-react";
import { toast } from "sonner";
import { WizardExplanation } from "../WizardExplanation";
import type { WizardConnector } from "../WizardTypes";

interface StepMappingProps {
  connector: WizardConnector;
  onNext: () => void;
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

export function StepMapping({ connector, onNext }: StepMappingProps) {
  const copySchema = (schema: typeof CANONICAL_ACTS_SCHEMA, label: string) => {
    navigator.clipboard.writeText(JSON.stringify(schema, null, 2));
    toast.success(`Esquema ${label} copiado`);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-5">
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
              Esquema Canónico: <Badge variant="outline">ACTUACIONES (work_item_acts)</Badge>
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
                    <td className="px-3 py-1.5">{f.required ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : "—"}</td>
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
              Esquema Canónico: <Badge variant="outline">PUBLICACIONES (work_item_publicaciones)</Badge>
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
                    <td className="px-3 py-1.5">{f.required ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : "—"}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{f.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center gap-2 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
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

      <div className="lg:col-span-2">
        <WizardExplanation
          title="Esquema Canónico"
          whatItDoes="Muestra los campos requeridos que el proveedor debe emitir para que ATENIA pueda ingerir datos en las tablas work_item_acts y work_item_publicaciones."
          whyItMatters="La arquitectura de ATENIA es provider-agnostic: no se crean tablas ni campos por proveedor. Todo dato externo se normaliza al esquema canónico, lo que permite deduplicación, merge multi-source, y auditoría forense."
          commonMistakes={[
            "El proveedor omite raw_data → se pierde auditabilidad",
            "hash_fingerprint no es estable → se crean duplicados",
            "event_date en formato incorrecto → los timelines se desordenan",
          ]}
        />
      </div>
    </div>
  );
}
