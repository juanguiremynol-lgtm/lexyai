/**
 * DataPartitionView — Shows where provider data goes in the canonical ATENIA schema.
 * Displays a deterministic table map + live partition report from E2E runs.
 */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Database, ArrowRight, Table2, FileJson, Shield, Layers } from "lucide-react";

interface PartitionReport {
  acts?: { ingested: number; extras_fields: number; missing_required: string[] };
  pubs?: { ingested: number; extras_fields: number; missing_required: string[] };
  unknown_sections?: string[];
}

interface DataPartitionViewProps {
  partitionReport?: PartitionReport | null;
}

const DATA_DESTINATIONS = [
  {
    icon: Table2,
    table: "work_item_acts",
    label: "Actuaciones",
    desc: "Registros canónicos de actuaciones judiciales",
    color: "text-primary",
    bgColor: "bg-primary/5 border-primary/20",
  },
  {
    icon: Table2,
    table: "work_item_publicaciones",
    label: "Publicaciones",
    desc: "Registros canónicos de publicaciones/estados",
    color: "text-primary",
    bgColor: "bg-primary/5 border-primary/20",
  },
  {
    icon: Shield,
    table: "act_provenance / pub_provenance",
    label: "Provenance",
    desc: "Trazabilidad de origen multi-proveedor",
    color: "text-primary",
    bgColor: "bg-primary/5 border-primary/20",
  },
  {
    icon: FileJson,
    table: "provider_raw_snapshots",
    label: "Raw Snapshots",
    desc: "Payload completo del proveedor para replay forense",
    color: "text-muted-foreground",
    bgColor: "bg-muted/20 border-border/30",
  },
  {
    icon: Layers,
    table: "work_item_*_extras",
    label: "Extras (JSONB)",
    desc: "Campos no mapeados del proveedor, preservados sin cambios de esquema",
    color: "text-muted-foreground",
    bgColor: "bg-muted/20 border-border/30",
  },
];

export function DataPartitionView({ partitionReport }: DataPartitionViewProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">¿A dónde van los datos?</h3>
      </div>

      <div className="space-y-2">
        {DATA_DESTINATIONS.map((dest) => (
          <div key={dest.table} className={`flex items-start gap-3 p-3 border rounded-lg ${dest.bgColor}`}>
            <dest.icon className={`h-4 w-4 mt-0.5 shrink-0 ${dest.color}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-medium text-foreground">{dest.table}</span>
                <Badge variant="outline" className="text-[9px]">{dest.label}</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">{dest.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Live partition report */}
      {partitionReport && (
        <Card className="border border-border/50">
          <CardContent className="p-4 space-y-3">
            <h4 className="text-xs font-semibold text-foreground flex items-center gap-2">
              <ArrowRight className="h-3 w-3 text-primary" />
              Resultado de Partición (último E2E)
            </h4>

            {partitionReport.acts && (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-muted/30 rounded p-2 text-center">
                  <p className="text-lg font-bold text-foreground">{partitionReport.acts.ingested}</p>
                  <p className="text-muted-foreground">Acts ingeridos</p>
                </div>
                <div className="bg-muted/30 rounded p-2 text-center">
                  <p className="text-lg font-bold text-foreground">{partitionReport.acts.extras_fields}</p>
                  <p className="text-muted-foreground">Campos extras</p>
                </div>
                <div className="bg-muted/30 rounded p-2 text-center">
                  <p className="text-lg font-bold text-foreground">{partitionReport.acts.missing_required.length}</p>
                  <p className="text-muted-foreground">Campos faltantes</p>
                </div>
              </div>
            )}

            {partitionReport.pubs && (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-muted/30 rounded p-2 text-center">
                  <p className="text-lg font-bold text-foreground">{partitionReport.pubs.ingested}</p>
                  <p className="text-muted-foreground">Pubs ingeridos</p>
                </div>
                <div className="bg-muted/30 rounded p-2 text-center">
                  <p className="text-lg font-bold text-foreground">{partitionReport.pubs.extras_fields}</p>
                  <p className="text-muted-foreground">Campos extras</p>
                </div>
                <div className="bg-muted/30 rounded p-2 text-center">
                  <p className="text-lg font-bold text-foreground">{partitionReport.pubs.missing_required.length}</p>
                  <p className="text-muted-foreground">Campos faltantes</p>
                </div>
              </div>
            )}

            {partitionReport.unknown_sections && partitionReport.unknown_sections.length > 0 && (
              <div className="text-xs">
                <p className="text-muted-foreground font-medium mb-1">Secciones no reconocidas:</p>
                <div className="flex flex-wrap gap-1">
                  {partitionReport.unknown_sections.map((s, i) => (
                    <Badge key={i} variant="outline" className="text-[9px] font-mono">
                      {s} <span className="ml-1 text-muted-foreground">→ Extras</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
