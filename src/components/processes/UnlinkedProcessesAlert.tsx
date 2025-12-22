import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { AlertTriangle, Link as LinkIcon, Users } from "lucide-react";
import { ProcessClientLink } from "./ProcessClientLink";
import { formatDateColombia } from "@/lib/constants";

interface UnlinkedProcess {
  id: string;
  radicado: string;
  despacho_name: string | null;
  created_at: string;
}

export function UnlinkedProcessesAlert() {
  const { data: unlinkedProcesses, refetch } = useQuery({
    queryKey: ["unlinked-processes"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("monitored_processes")
        .select("id, radicado, despacho_name, created_at")
        .eq("owner_id", user.id)
        .is("client_id", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as UnlinkedProcess[];
    },
  });

  if (!unlinkedProcesses || unlinkedProcesses.length === 0) {
    return null;
  }

  return (
    <Alert variant="default" className="border-amber-300 bg-amber-50">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertTitle className="text-amber-800">
        {unlinkedProcesses.length} proceso(s) sin vincular a cliente
      </AlertTitle>
      <AlertDescription className="text-amber-700">
        <p className="mb-3">
          Vincule estos procesos a un cliente para organizar mejor su información.
        </p>
        <div className="space-y-2">
          {unlinkedProcesses.slice(0, 3).map((process) => (
            <div key={process.id} className="flex items-center justify-between bg-white p-2 rounded border">
              <div>
                <code className="text-xs">{process.radicado}</code>
                {process.despacho_name && (
                  <p className="text-xs text-muted-foreground">{process.despacho_name}</p>
                )}
              </div>
              <ProcessClientLink
                processId={process.id}
                processRadicado={process.radicado}
                onLinked={() => refetch()}
              />
            </div>
          ))}
          {unlinkedProcesses.length > 3 && (
            <p className="text-sm text-amber-700">
              Y {unlinkedProcesses.length - 3} proceso(s) más...
            </p>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function UnlinkedProcessesPage() {
  const { data: unlinkedProcesses, isLoading, refetch } = useQuery({
    queryKey: ["unlinked-processes"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("monitored_processes")
        .select("id, radicado, despacho_name, created_at")
        .eq("owner_id", user.id)
        .is("client_id", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as UnlinkedProcess[];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold">Procesos Sin Vincular</h1>
        <p className="text-muted-foreground">
          Vincule procesos a clientes para organizar mejor su información
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5" />
            Procesos Pendientes de Vinculación
          </CardTitle>
          <CardDescription>
            Estos procesos no están asociados a ningún cliente
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Cargando...</div>
          ) : unlinkedProcesses?.length === 0 ? (
            <div className="text-center py-12">
              <Users className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-medium">Todos los procesos están vinculados</h3>
              <p className="text-muted-foreground">
                No hay procesos pendientes de vincular a un cliente
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Radicado</TableHead>
                  <TableHead>Despacho</TableHead>
                  <TableHead>Agregado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unlinkedProcesses?.map((process) => (
                  <TableRow key={process.id}>
                    <TableCell>
                      <code className="text-sm bg-muted px-2 py-1 rounded">
                        {process.radicado}
                      </code>
                    </TableCell>
                    <TableCell>{process.despacho_name || "—"}</TableCell>
                    <TableCell>{formatDateColombia(process.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <ProcessClientLink
                        processId={process.id}
                        processRadicado={process.radicado}
                        onLinked={() => refetch()}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
