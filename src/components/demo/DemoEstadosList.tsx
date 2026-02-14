/**
 * DemoEstadosList — Display estados/publicaciones in demo mode
 * Props-only, no Supabase.
 */

import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
import type { DemoEstado } from "./demo-types";

interface Props {
  estados: DemoEstado[];
}

export function DemoEstadosList({ estados }: Props) {
  if (estados.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p>No se encontraron estados para este radicado.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {estados.map((estado, i) => (
        <div
          key={i}
          className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
        >
          <div className="flex-shrink-0 mt-0.5">
            <div className="h-2 w-2 rounded-full bg-primary/60" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground font-mono">
                {estado.fecha
                  ? new Date(estado.fecha).toLocaleDateString("es-CO", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })
                  : estado.fecha}
              </span>
              <Badge variant="outline" className="text-xs">
                {estado.tipo}
              </Badge>
              {i === 0 && (
                <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">
                  Actual
                </Badge>
              )}
            </div>
            {estado.descripcion && (
              <p className="text-sm text-muted-foreground">
                {estado.descripcion}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
