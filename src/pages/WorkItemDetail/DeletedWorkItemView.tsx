import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Archive, ArrowLeft, RotateCcw, Trash2 } from "lucide-react";
import { useWorkItemActions } from "@/hooks/use-work-item-actions";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface Props {
  workItem: {
    id: string;
    radicado?: string | null;
    title?: string | null;
    client_id?: string | null;
    workflow_type?: string | null;
    lifecycle_state?: string | null;
    monitoring_enabled?: boolean | null;
    deleted_at?: string | null;
    stage?: string | null;
  };
  purgeAfter: string | null;
  onBack: () => void;
  onAfter: () => void;
}

export function DeletedWorkItemView({ workItem, purgeAfter, onBack, onAfter }: Props) {
  const { actions, isPending } = useWorkItemActions(workItem, { onSuccess: onAfter });

  const daysLeft = purgeAfter
    ? Math.max(0, Math.ceil((new Date(purgeAfter).getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <div className="max-w-2xl mx-auto pt-8 space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
        <ArrowLeft className="h-4 w-4" /> Volver
      </Button>

      <Card className="border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
              <Archive className="h-5 w-5 text-amber-700 dark:text-amber-300" />
            </div>
            <div>
              <CardTitle className="text-lg">Expediente en la papelera</CardTitle>
              <p className="text-sm text-muted-foreground font-mono mt-0.5">
                {workItem.radicado || workItem.title || workItem.id}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm space-y-1">
            {workItem.deleted_at && (
              <p>
                <span className="text-muted-foreground">Eliminado:</span>{" "}
                {formatDistanceToNow(new Date(workItem.deleted_at), { addSuffix: true, locale: es })}
              </p>
            )}
            {purgeAfter && (
              <p>
                <span className="text-muted-foreground">Se eliminará definitivamente:</span>{" "}
                <span className="font-medium">
                  {format(new Date(purgeAfter), "d MMM yyyy", { locale: es })}
                </span>
                {daysLeft !== null && (
                  <span className="text-muted-foreground"> (en {daysLeft} día{daysLeft !== 1 ? "s" : ""})</span>
                )}
              </p>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            El monitoreo está detenido. Puedes restaurarlo antes del vencimiento; después, todos los datos
            asociados (actuaciones, estados, tareas y documentos) se eliminarán permanentemente.
          </p>

          <div className="flex gap-2 pt-2">
            <Button onClick={() => actions.restaurar()} disabled={isPending} className="gap-1.5">
              <RotateCcw className="h-4 w-4" />
              Restaurar
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (confirm("Esta acción eliminará el expediente permanentemente y no se podrá recuperar. ¿Continuar?")) {
                  void actions.eliminarDefinitivo();
                }
              }}
              disabled={isPending}
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Eliminar definitivamente
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}