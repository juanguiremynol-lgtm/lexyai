import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Calendar, User, Building2, MapPin, Users, Gavel, FileText } from "lucide-react";
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
        {/* Latest Estado - Full Details */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <FileText className="h-4 w-4" />
            Estado más reciente
          </div>
          
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
        </div>

        {/* History Table */}
        {estados.length > 1 && (
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Historial de Importaciones ({estados.length - 1} anteriores)
            </h4>
            <ScrollArea className="h-[250px] border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha Importación</TableHead>
                    <TableHead>Última Actuación</TableHead>
                    <TableHead>Despacho</TableHead>
                    <TableHead>Distrito</TableHead>
                    <TableHead>Juez</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {estados.slice(1).map((estado) => (
                    <TableRow key={estado.id}>
                      <TableCell className="text-sm">
                        <Badge variant="outline" className="text-xs">
                          {formatDateColombia(estado.created_at)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {estado.fecha_ultima_actuacion
                          ? formatDateColombia(estado.fecha_ultima_actuacion)
                          : estado.fecha_ultima_actuacion_raw || "-"}
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">
                        {estado.despacho || "-"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {estado.distrito || "-"}
                      </TableCell>
                      <TableCell className="text-sm max-w-[150px] truncate">
                        {estado.juez_ponente || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}