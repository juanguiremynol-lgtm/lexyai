import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Calendar, User, Building2, MapPin, Users, Gavel, FileText, Info, Clock, ClipboardList } from "lucide-react";
import { formatDateColombia } from "@/lib/constants";

interface EstadosListProps {
  processId: string;
}

interface ProcessEstado {
  id: string;
  radicado: string;
  distrito: string | null;
  despacho: string | null;
  juez_ponente: string | null;
  demandantes: string | null;
  demandados: string | null;
  fecha_ultima_actuacion: string | null;
  fecha_ultima_actuacion_raw: string | null;
  created_at: string;
  source_payload: Record<string, unknown> | null;
}

// Known column mappings for display labels
const COLUMN_LABELS: Record<string, string> = {
  "numero del proceso": "Número del Proceso",
  "número del proceso": "Número del Proceso",
  "radicado": "Radicado",
  "distrito": "Distrito",
  "despacho": "Despacho",
  "juez/ponente": "Juez/Ponente",
  "juez / ponente": "Juez/Ponente",
  "demandante(s)": "Demandante(s)",
  "demandantes": "Demandante(s)",
  "demandado(s)": "Demandado(s)",
  "demandados": "Demandado(s)",
  "fecha de la ultima actuacion": "Fecha Última Actuación",
  "fecha de la última actuación": "Fecha Última Actuación",
  "actuacion": "Actuación",
  "actuación": "Actuación",
  "anotacion": "Anotación",
  "anotación": "Anotación",
  "inicia termino": "Inicia Término",
  "inicia término": "Inicia Término",
  "fecha inicia termino": "Fecha Inicia Término",
  "fecha inicia término": "Fecha Inicia Término",
  "fecha registro": "Fecha de Registro",
  "fecha de registro": "Fecha de Registro",
};

function getColumnLabel(key: string): string {
  const normalized = key.toLowerCase().trim();
  return COLUMN_LABELS[normalized] || key;
}

function getColumnIcon(key: string): React.ReactNode {
  const normalized = key.toLowerCase();
  if (normalized.includes("fecha")) return <Calendar className="h-3 w-3" />;
  if (normalized.includes("despacho") || normalized.includes("juzgado")) return <Building2 className="h-3 w-3" />;
  if (normalized.includes("distrito") || normalized.includes("ciudad")) return <MapPin className="h-3 w-3" />;
  if (normalized.includes("juez") || normalized.includes("ponente")) return <Gavel className="h-3 w-3" />;
  if (normalized.includes("demandante")) return <Users className="h-3 w-3" />;
  if (normalized.includes("demandado")) return <User className="h-3 w-3" />;
  if (normalized.includes("actuacion") || normalized.includes("actuación")) return <ClipboardList className="h-3 w-3" />;
  if (normalized.includes("anotacion") || normalized.includes("anotación")) return <FileText className="h-3 w-3" />;
  if (normalized.includes("termino") || normalized.includes("término")) return <Clock className="h-3 w-3" />;
  return <Info className="h-3 w-3" />;
}

export function EstadosList({ processId }: EstadosListProps) {
  const { data: estados, isLoading } = useQuery({
    queryKey: ["process-estados", processId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("process_estados")
        .select("*")
        .eq("monitored_process_id", processId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as ProcessEstado[];
    },
    enabled: !!processId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Estados Importados</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!estados || estados.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Estados Importados</CardTitle>
          <CardDescription>
            Información de estados importados desde archivos Excel
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No hay estados importados para este proceso</p>
            <p className="text-sm mt-2">
              Importe un archivo Excel desde Configuración → Estados
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const latestEstado = estados[0];
  const allColumns = latestEstado.source_payload?.all_columns as Record<string, string> | undefined;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Estados Importados</CardTitle>
            <CardDescription>
              {estados.length} registro(s) importados
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-xs">
            <Calendar className="h-3 w-3 mr-1" />
            Última importación: {formatDateColombia(latestEstado.created_at)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Latest Estado - Full Details from source_payload */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <FileText className="h-4 w-4" />
            Estado más reciente - Información completa del Excel
          </div>
          
          {/* Display all columns from source_payload */}
          {allColumns && Object.keys(allColumns).length > 0 ? (
            <div className="space-y-4">
              {Object.entries(allColumns).map(([key, value]) => {
                if (!value || value.trim() === "") return null;
                
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                      {getColumnIcon(key)}
                      {getColumnLabel(key)}
                    </div>
                    <div className="text-sm bg-background rounded border p-2 whitespace-pre-wrap">
                      {value}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // Fallback to structured fields if no source_payload
            <>
              {/* Radicado */}
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Número de Radicado</div>
                <code className="text-sm font-mono bg-background px-2 py-1 rounded border">
                  {latestEstado.radicado}
                </code>
              </div>

              <Separator />

              {/* Location Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <MapPin className="h-3 w-3" />
                    Distrito
                  </div>
                  <p className="text-sm font-medium">
                    {latestEstado.distrito || <span className="text-muted-foreground italic">No especificado</span>}
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <Building2 className="h-3 w-3" />
                    Despacho
                  </div>
                  <p className="text-sm font-medium">
                    {latestEstado.despacho || <span className="text-muted-foreground italic">No especificado</span>}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Judge */}
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                  <Gavel className="h-3 w-3" />
                  Juez Ponente
                </div>
                <p className="text-sm font-medium">
                  {latestEstado.juez_ponente || <span className="text-muted-foreground italic">No especificado</span>}
                </p>
              </div>

              <Separator />

              {/* Parties */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <Users className="h-3 w-3" />
                    Demandantes
                  </div>
                  <p className="text-sm">
                    {latestEstado.demandantes || <span className="text-muted-foreground italic">No especificado</span>}
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <User className="h-3 w-3" />
                    Demandados
                  </div>
                  <p className="text-sm">
                    {latestEstado.demandados || <span className="text-muted-foreground italic">No especificado</span>}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Last Action Date */}
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                  <Calendar className="h-3 w-3" />
                  Fecha Última Actuación
                </div>
                <div className="flex items-center gap-2">
                  {latestEstado.fecha_ultima_actuacion ? (
                    <Badge variant="secondary">
                      {formatDateColombia(latestEstado.fecha_ultima_actuacion)}
                    </Badge>
                  ) : latestEstado.fecha_ultima_actuacion_raw ? (
                    <Badge variant="outline">
                      {latestEstado.fecha_ultima_actuacion_raw}
                    </Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">No especificada</span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* History - Show all columns for each historical record */}
        {estados.length > 1 && (
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Historial de Importaciones ({estados.length - 1} anteriores)
            </h4>
            <ScrollArea className="h-[400px] border rounded-lg p-2">
              <Accordion type="single" collapsible className="space-y-2">
                {estados.slice(1).map((estado, index) => {
                  const estadoColumns = estado.source_payload?.all_columns as Record<string, string> | undefined;
                  
                  return (
                    <AccordionItem key={estado.id} value={estado.id} className="border rounded-lg px-4">
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-3 text-left">
                          <Badge variant="outline" className="text-xs shrink-0">
                            {formatDateColombia(estado.created_at)}
                          </Badge>
                          <span className="text-sm text-muted-foreground truncate">
                            {estado.despacho || estado.radicado}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3 pt-2">
                          {estadoColumns && Object.keys(estadoColumns).length > 0 ? (
                            Object.entries(estadoColumns).map(([key, value]) => {
                              if (!value || value.trim() === "") return null;
                              
                              return (
                                <div key={key} className="space-y-1">
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                                    {getColumnIcon(key)}
                                    {getColumnLabel(key)}
                                  </div>
                                  <div className="text-sm bg-muted/50 rounded p-2 whitespace-pre-wrap">
                                    {value}
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <span className="text-muted-foreground">Distrito:</span> {estado.distrito || "-"}
                              </div>
                              <div>
                                <span className="text-muted-foreground">Despacho:</span> {estado.despacho || "-"}
                              </div>
                              <div>
                                <span className="text-muted-foreground">Juez:</span> {estado.juez_ponente || "-"}
                              </div>
                              <div>
                                <span className="text-muted-foreground">Última actuación:</span>{" "}
                                {estado.fecha_ultima_actuacion
                                  ? formatDateColombia(estado.fecha_ultima_actuacion)
                                  : estado.fecha_ultima_actuacion_raw || "-"}
                              </div>
                            </div>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}