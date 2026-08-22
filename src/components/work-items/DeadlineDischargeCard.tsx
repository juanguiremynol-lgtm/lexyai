/**
 * FF2(b) — confirm-or-reject card for a presumed discharge.
 *
 * Shows the actuación that matched, its date and the norma, so the lawyer can
 * decide in five seconds. Nothing closes without an explicit confirmation.
 */
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useDeadlineDischargeSuggestions,
  useDecideDischarge,
} from "@/hooks/use-deadline-discharge-suggestions";

interface Props {
  workItemId: string;
}

export function DeadlineDischargeCard({ workItemId }: Props) {
  const { data: suggestions = [] } = useDeadlineDischargeSuggestions(workItemId);
  const decide = useDecideDischarge(workItemId);

  if (suggestions.length === 0) return null;

  const onDecide = (suggestionId: string, confirm: boolean) => {
    decide.mutate(
      { suggestionId, confirm },
      {
        onSuccess: () =>
          toast.success(
            confirm ? "Término marcado como cumplido." : "Sugerencia descartada.",
          ),
        onError: () => toast.error("No fue posible registrar la decisión."),
      },
    );
  };

  return (
    <div className="space-y-3">
      {suggestions.map((s) => (
        <Card key={s.id} className="border-primary/40">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Presuntamente cumplido</Badge>
                <span className="text-sm font-medium">{s.discharge_label}</span>
                {s.norma && (
                  <span className="text-xs text-muted-foreground">{s.norma}</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {s.act_date
                  ? format(new Date(`${s.act_date}T00:00:00`), "d 'de' MMMM 'de' yyyy", {
                      locale: es,
                    })
                  : "Sin fecha"}
                {s.act_text ? ` · ${s.act_text}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                disabled={decide.isPending}
                onClick={() => onDecide(s.id, true)}
              >
                <CheckCircle2 className="mr-1 h-4 w-4" />
                Confirmar
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={decide.isPending}
                onClick={() => onDecide(s.id, false)}
              >
                <XCircle className="mr-1 h-4 w-4" />
                No cumplido
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
