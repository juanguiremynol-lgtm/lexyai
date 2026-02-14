/**
 * DemoWorkItemCard — Mirrors the real pipeline Kanban card styling.
 * Pure presentational, no Supabase.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Activity, LayoutGrid } from "lucide-react";
import type { DemoResumen } from "./demo-types";

interface Props {
  resumen: DemoResumen;
}

export function DemoWorkItemCard({ resumen }: Props) {
  return (
    <Card className="relative overflow-hidden">
      {/* Demo badge */}
      <div className="absolute top-2 right-2">
        <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">
          DEMO
        </Badge>
      </div>

      <CardContent className="p-4 space-y-3">
        {/* Radicado */}
        <p className="font-mono text-xs leading-tight pr-12">
          {resumen.radicado_display}
        </p>

        {/* Metadata */}
        <div className="space-y-2">
          {resumen.despacho && (
            <p className="text-xs text-muted-foreground truncate">
              {resumen.despacho}
            </p>
          )}
          {resumen.jurisdiccion && (
            <Badge variant="secondary" className="text-[10px]">
              {resumen.jurisdiccion}
            </Badge>
          )}
          {resumen.ultima_actuacion_fecha && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Última: {new Date(resumen.ultima_actuacion_fecha).toLocaleDateString("es-CO")}
            </p>
          )}
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Activity className="h-3 w-3" />
              {resumen.total_actuaciones} act.
            </span>
            <span className="flex items-center gap-1">
              <LayoutGrid className="h-3 w-3" />
              {resumen.total_estados} est.
            </span>
          </div>
        </div>

        {/* Fake action buttons (disabled) */}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="text-xs h-7" disabled>
            Ver detalle
          </Button>
          <Button variant="outline" size="sm" className="text-xs h-7" disabled>
            Sincronizar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
