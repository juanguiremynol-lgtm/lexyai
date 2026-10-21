import { useLastOccurredEvent } from "@/hooks/use-last-occurred-event";
import { formatCivilDate } from "@/lib/civil-date";

/** "Última actuación" from stored records; future source dates shown separately, never as scheduled events. */
export function LastOccurredEventField({ workItemId, label = "Última actuación" }: { workItemId: string; label?: string }) {
  const { data } = useLastOccurredEvent(workItemId);
  if (!data?.last && !data?.nextScheduled) return null;
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium">{data.last ? formatCivilDate(data.last.day) : "Sin novedades ocurridas"}</p>
      {data.last && <p className="text-xs text-muted-foreground">{data.last.kind === "ESTADO" ? "Estado" : "Actuación"}: {data.last.title.slice(0, 80)}</p>}
      {data.nextScheduled && (
        <p className="text-xs text-primary">Fecha futura informada por el origen: {formatCivilDate(data.nextScheduled.day)} (se conserva tal cual; no se trata como ocurrida ni como evento programado)</p>
      )}
    </div>
  );
}
