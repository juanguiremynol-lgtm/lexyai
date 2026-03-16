import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, Bell, ArrowRight, Loader2 } from "lucide-react";
import { useCpnuNovedades } from "@/hooks/use-cpnu-novedades";
import { useState } from "react";

interface Props {
  workItemId: string;
}

export default function NovedadesCpnuPanel({ workItemId }: Props) {
  const { novedades, isLoading, markAsReviewed, isMarking } = useCpnuNovedades(workItemId);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const handleMark = (id: string) => {
    setMarkingId(id);
    markAsReviewed(id, {
      onSettled: () => setMarkingId(null),
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-4 w-4" />
          Novedades
        </CardTitle>
        {novedades.length > 0 && (
          <Badge variant="warning">{novedades.length}</Badge>
        )}
      </CardHeader>
      <CardContent>
        {novedades.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin novedades pendientes</p>
        ) : (
          <div className="space-y-3">
            {novedades.map((n) => (
              <div
                key={n.id}
                className="rounded-md border border-border/50 bg-muted/30 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 flex-1 min-w-0">
                    <Badge variant="outline" className="text-[10px]">
                      {n.tipo_novedad}
                    </Badge>
                    <p className="text-sm">{n.descripcion}</p>
                    {(n.valor_anterior || n.valor_nuevo) && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="truncate max-w-[120px]">{n.valor_anterior ?? "—"}</span>
                        <ArrowRight className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[120px] text-foreground font-medium">
                          {n.valor_nuevo ?? "—"}
                        </span>
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(n.created_at).toLocaleDateString("es-CO", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 h-8 text-xs"
                    disabled={isMarking && markingId === n.id}
                    onClick={() => handleMark(n.id)}
                  >
                    {isMarking && markingId === n.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <CheckCircle className="h-3 w-3" />
                    )}
                    Revisada
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
