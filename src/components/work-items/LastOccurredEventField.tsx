import { useLastOccurredEvent } from "@/hooks/use-last-occurred-event";
import { formatCivilDate } from "@/lib/colombia-date-utils";

/** "Última actuación" from stored records; future dates shown as programadas. */
export function LastOccurredEventField({ workItemId, label = "Última actuación" }: { workItemId: string; label?: string }) {
  const { data } = useLastOccurredEvent(workItemId);
  if (!data?.last && !data?.nextScheduled) return null;
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium">{data.last ? formatCivilDate(data.last.day) : "Sin novedades ocurridas"}</p>
      {data.last && <p className="text-xs text-muted-foreground">{data.last.kind === "ESTADO" ? "Estado" : "Actuación"}: {data.last.title.slice(0, 80)}</p>}
      {data.nextScheduled && (
        <p className="text-xs text-primary">Programada: {formatCivilDate(data.nextScheduled.day)} (fecha informada por el portal; aún no ocurrida)</p>
      )}
    </div>
  );
}
