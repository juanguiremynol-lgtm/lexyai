import { useState, useEffect } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { isBusinessDay, isColombianHoliday } from "@/lib/colombian-holidays";
import { Clock, Calendar, PartyPopper, Briefcase } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ColombianClock() {
  const [now, setNow] = useState(new Date());

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
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          {holiday.isHoliday ? (
            <p className="text-sm">
              <strong>Festivo:</strong> {holiday.name}
              <br />
              <span className="text-muted-foreground text-xs">
                Los términos judiciales no corren hoy.
              </span>
            </p>
          ) : isWorkDay ? (
            <p className="text-sm">
              <strong>Día hábil</strong>
              <br />
              <span className="text-muted-foreground text-xs">
                Los términos judiciales corren normalmente.
              </span>
            </p>
          ) : (
            <p className="text-sm">
              <strong>Fin de semana</strong>
              <br />
              <span className="text-muted-foreground text-xs">
                Los términos judiciales no corren hoy.
              </span>
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
