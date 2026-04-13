import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Users, Scale } from "lucide-react";
import type { WorkItem } from "@/types/work-item";

interface Props { workItem: WorkItem; }

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium">{value || "—"}</p>
    </div>
  );
}

export default function CpacaDetailModule({ workItem }: Props) {
  const w = workItem as any;

  const demandantesList = w.demandantes?.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean) || [];
  const demandadosList = w.demandados?.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean) || [];

  return (
    <div className="space-y-4">
      {/* Primary SAMAI info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Scale className="h-4 w-4 text-primary" />
            Información CPACA
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <Field label="Ponente" value={w.ponente} />
          <Field label="Clase de Proceso" value={w.clase_proceso} />
          <Field label="Etapa" value={w.etapa} />
          <Field label="Ubicación del Expediente" value={w.ubicacion_expediente} />
        </CardContent>
      </Card>

      {/* Secondary info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Información Adicional</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-sm">
          <Field label="Tipo de Proceso" value={w.tipo_proceso} />
          <Field label="Formato del Expediente" value={w.formato_expediente} />
          <Field label="Subclase" value={w.subclase_proceso} />
          <Field label="Fecha de Radicado" value={w.fecha_radicado} />
          <Field label="Fecha de Sentencia" value={w.fecha_sentencia} />
          <Field label="Origen" value={w.origen} />
        </CardContent>
      </Card>

      {/* Sujetos procesales */}
      {(demandantesList.length > 0 || demandadosList.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-primary" />
                Sujetos Procesales
              </CardTitle>
              {w.total_sujetos_procesales != null && (
                <span className="text-sm text-muted-foreground">
                  Total: {w.total_sujetos_procesales}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-6">
              {demandantesList.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Demandantes</p>
                  <ul className="space-y-1">
                    {demandantesList.map((name: string, i: number) => (
                      <li key={i} className="text-sm">{name}</li>
                    ))}
                  </ul>
                </div>
              )}
              {demandadosList.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Demandados</p>
                  <ul className="space-y-1">
                    {demandadosList.map((name: string, i: number) => (
                      <li key={i} className="text-sm">{name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
