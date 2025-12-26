import { useState, useEffect } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { isBusinessDay, isColombianHoliday } from "@/lib/colombian-holidays";
import { Clock, Calendar, PartyPopper, Briefcase, PauseCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTermStatus } from "@/hooks/use-term-status";

export function ColombianClock() {
  const [now, setNow] = useState(new Date());
  const { data: termStatus } = useTermStatus();

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const holiday = isColombianHoliday(now);
  const isWorkDay = isBusinessDay(now);
  const timeStr = format(now, "HH:mm:ss");
  const dateStr = format(now, "EEEE, d 'de' MMMM", { locale: es });
  const capitalizedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

  // Determine judicial term status
  const isJudicialSuspended = termStatus?.activeSuspension !== null && termStatus?.activeSuspension !== undefined;
  const suspensionName = termStatus?.activeSuspension?.title;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="hidden lg:flex items-center gap-3 px-3 py-1.5 rounded-lg bg-muted/50 border border-border/50">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="font-mono text-sm font-medium tabular-nums">
                {timeStr}
              </span>
            </div>
            <div className="w-px h-4 bg-border" />
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span className="text-sm">{capitalizedDate}</span>
            </div>
            
            {/* Admin day status */}
            {holiday.isHoliday ? (
              <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                <PartyPopper className="h-3 w-3" />
                Festivo
              </Badge>
            ) : isWorkDay ? (
              <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                <Briefcase className="h-3 w-3" />
                Hábil
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                Fin de semana
              </Badge>
            )}

            {/* Judicial term status - shows suspension if active */}
            {isJudicialSuspended && (
              <Badge variant="secondary" className="gap-1 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                <PauseCircle className="h-3 w-3" />
                Términos Suspendidos
              </Badge>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-sm">
          <div className="space-y-2">
            {/* Admin regime info */}
            <div>
              <p className="text-sm font-medium">Régimen Administrativo (Peticiones)</p>
              {holiday.isHoliday ? (
                <p className="text-xs text-muted-foreground">
                  Festivo: {holiday.name}. No es día hábil administrativo.
                </p>
              ) : isWorkDay ? (
                <p className="text-xs text-muted-foreground">
                  Día hábil. Los términos de peticiones corren.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Fin de semana. No es día hábil administrativo.
                </p>
              )}
            </div>

            {/* Judicial regime info */}
            <div className="border-t pt-2">
              <p className="text-sm font-medium">Régimen Judicial (CGP/Tutelas)</p>
              {isJudicialSuspended ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  <strong>SUSPENDIDO:</strong> {suspensionName}
                  <br />
                  Los términos judiciales no corren. Peticiones NO se ven afectadas.
                </p>
              ) : holiday.isHoliday ? (
                <p className="text-xs text-muted-foreground">
                  Festivo: {holiday.name}. Los términos judiciales no corren.
                </p>
              ) : isWorkDay ? (
                <p className="text-xs text-muted-foreground">
                  Día hábil judicial. Los términos judiciales corren normalmente.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Fin de semana. Los términos judiciales no corren.
                </p>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
