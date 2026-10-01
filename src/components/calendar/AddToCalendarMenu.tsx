/**
 * AddToCalendarMenu — "Añadir al calendario" for one dated term or hearing.
 * Renders nothing when the event is null (manual review, dateless marker).
 * Never creates events in external accounts: it only opens a prefilled
 * Google / Outlook compose page or downloads a local .ics file.
 */
import { CalendarPlus, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  buildIcs, googleCalendarUrl, icsFileName, outlookCalendarUrl, type CalendarEvent,
} from "@/lib/calendar-export";

export function AddToCalendarMenu({ event, size = "sm" }: { event: CalendarEvent | null; size?: "sm" | "xs" }) {
  if (!event) return null;
  const downloadIcs = () => {
    const blob = new Blob([buildIcs(event)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = icsFileName(event);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={size === "xs" ? "h-7 text-xs" : undefined}>
          <CalendarPlus className="h-3.5 w-3.5 mr-1" />
          Añadir al calendario
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={downloadIcs}>
          <Download className="h-4 w-4 mr-2" />
          Descargar .ics (Apple, Outlook, otros)
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">Añadir a Google Calendar</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={outlookCalendarUrl(event)} target="_blank" rel="noopener noreferrer">Añadir a Outlook</a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
