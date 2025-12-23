import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, User, Building2 } from "lucide-react";
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
            Información de estados importados desde archivos Excel de ICARUS
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
        <CardTitle>Estados Importados</CardTitle>
        <CardDescription>
          {estados.length} registro(s) - Última importación: {formatDateColombia(latestEstado.created_at)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Latest Estado Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" />
              Despacho
            </div>
            <p className="text-sm font-medium">
              {latestEstado.despacho || "No especificado"}
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <User className="h-4 w-4" />
              Juez Ponente
            </div>
            <p className="text-sm font-medium">
              {latestEstado.juez_ponente || "No especificado"}
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              Última Actuación
            </div>
            <Badge variant="secondary">
              {latestEstado.fecha_ultima_actuacion
                ? formatDateColombia(latestEstado.fecha_ultima_actuacion)
                : latestEstado.fecha_ultima_actuacion_raw || "No especificada"}
            </Badge>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              Distrito
            </div>
            <p className="text-sm font-medium">
              {latestEstado.distrito || "No especificado"}
            </p>
          </div>
        </div>

        {/* Parties */}
        <div className="space-y-4">
          {latestEstado.demandantes && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">Demandantes</h4>
              <p className="text-sm">{latestEstado.demandantes}</p>
            </div>
          )}
          {latestEstado.demandados && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">Demandados</h4>
              <p className="text-sm">{latestEstado.demandados}</p>
            </div>
          )}
        </div>

        {/* History */}
        {estados.length > 1 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Historial de Estados</h4>
            <ScrollArea className="h-[200px] border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha Importación</TableHead>
                    <TableHead>Última Actuación</TableHead>
                    <TableHead>Distrito</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {estados.map((estado) => (
                    <TableRow key={estado.id}>
                      <TableCell className="text-sm">
                        {formatDateColombia(estado.created_at)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {estado.fecha_ultima_actuacion_raw || "-"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {estado.distrito || "-"}
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
