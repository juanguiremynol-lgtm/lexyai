/**
 * DemoActuacionesTimeline — Visual timeline of actuaciones for demo
 * Props-only, no Supabase, no auth.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";

interface DemoActuacion {
  fecha: string;
  tipo: string | null;
  descripcion: string;
  anotacion: string | null;
}

interface Props {
  actuaciones: DemoActuacion[];
}

export function DemoActuacionesTimeline({ actuaciones }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? actuaciones : actuaciones.slice(0, 10);

  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  if (actuaciones.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p>No se encontraron actuaciones para este radicado.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-[19px] top-0 bottom-0 w-px bg-border" />

        {visible.map((act, i) => (
          <div key={i} className="relative flex gap-3 pb-4">
            {/* Dot */}
            <div className="relative z-10 flex-shrink-0 mt-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground font-mono">
                  {act.fecha}
                </span>
                {act.tipo && (
                  <Badge variant="secondary" className="text-xs max-w-[280px] truncate">
                    {act.tipo}
                  </Badge>
                )}
              </div>

              <p className="text-sm text-foreground leading-relaxed">
                {expanded.has(i)
                  ? act.descripcion
                  : act.descripcion.length > 120
                    ? act.descripcion.slice(0, 120) + "..."
                    : act.descripcion}
              </p>

              {act.descripcion.length > 120 && (
                <button
                  onClick={() => toggle(i)}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  {expanded.has(i) ? (
                    <>Menos <ChevronUp className="h-3 w-3" /></>
                  ) : (
                    <>Más <ChevronDown className="h-3 w-3" /></>
                  )}
                </button>
              )}

              {act.anotacion && expanded.has(i) && (
                <div className="mt-1 text-xs text-muted-foreground bg-muted/50 rounded p-2 border">
                  {act.anotacion}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {actuaciones.length > 10 && (
        <div className="text-center pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll
              ? `Mostrar menos`
              : `Ver ${actuaciones.length - 10} actuaciones más`}
          </Button>
        </div>
      )}
    </div>
  );
}
