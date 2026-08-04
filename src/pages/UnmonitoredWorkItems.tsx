/**
 * "Expedientes sin monitoreo" — one-screen review list (iteration 13.1).
 */

import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Eye, PauseCircle, Play } from "lucide-react";
import { useUnmonitoredWorkItems, useActivateMonitoring } from "@/hooks/use-unmonitored-work-items";
import { getProviderChainShort } from "@/lib/provider-chain-labels";
import { formatActDate } from "@/lib/colombia-date-utils";

export default function UnmonitoredWorkItems() {
  const { data, isLoading } = useUnmonitoredWorkItems();
  const activate = useActivateMonitoring();

  const rows = data ?? [];
  const liveCount = rows.filter((r) => r.procedurally_live).length;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <PauseCircle className="h-6 w-6 text-orange-500" />
          Expedientes sin monitoreo
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          El silencio de estos expedientes no significa ausencia de movimiento: nadie está
          consultando los proveedores judiciales por ellos. La reactivación es siempre manual.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {rows.length} expediente{rows.length === 1 ? "" : "s"} con monitoreo apagado
          </CardTitle>
          <CardDescription>
            {liveCount > 0
              ? `${liveCount} está${liveCount === 1 ? "" : "n"} en etapa procesalmente viva (entre el auto admisorio y la sentencia o el archivo).`
              : "Ninguno está en etapa procesalmente viva."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Todos los expedientes activos están siendo monitoreados.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Radicado</TableHead>
                  <TableHead>Flujo</TableHead>
                  <TableHead>Etapa</TableHead>
                  <TableHead>Última actuación</TableHead>
                  <TableHead>Razón</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.work_item_id} className={r.procedurally_live ? "bg-orange-50/50 dark:bg-orange-950/10" : undefined}>
                    <TableCell>
                      <div className="font-mono text-xs">{r.radicado ?? "—"}</div>
                      {r.title && <div className="text-xs text-muted-foreground truncate max-w-[220px]">{r.title}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">{r.workflow_type ?? "—"}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {getProviderChainShort(r.workflow_type)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Badge variant="secondary" className="text-xs">{r.stage ?? "—"}</Badge>
                        {r.procedurally_live && (
                          <Badge variant="outline" className="gap-1 text-[10px] border-orange-500/50 text-orange-600">
                            <AlertTriangle className="h-3 w-3" />
                            Proceso vivo
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.last_act_date ? formatActDate(r.last_act_date) : "Nunca"}
                      {r.last_act_description && (
                        <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                          {r.last_act_description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                      {r.monitoring_disabled_reason ?? "Sin razón registrada"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 mr-2"
                        disabled={activate.isPending}
                        onClick={() => activate.mutate(r.work_item_id)}
                      >
                        <Play className="h-3 w-3" />
                        Activar monitoreo
                      </Button>
                      <Link to={`/app/work-items/${r.work_item_id}`}>
                        <Button size="sm" variant="ghost" className="gap-1">
                          <Eye className="h-3 w-3" />
                          Ver
                        </Button>
                      </Link>
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
