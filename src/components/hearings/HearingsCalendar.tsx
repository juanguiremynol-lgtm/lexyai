/**
 * HearingsCalendar — Monthly calendar view showing hearings as colored dots.
 * Clicking a day shows hearings for that day in a side panel.
 */

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, MapPin, Video, Eye, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AddToCalendarMenu } from "@/components/calendar/AddToCalendarMenu";
import { hearingEvent, termEvent } from "@/lib/calendar-export";

/** Bogotá wall-clock date (UTC-5, no DST) for a timestamp. */
export function bogotaDateKey(iso: string): string {
  return new Date(new Date(iso).getTime() - 5 * 3600_000).toISOString().slice(0, 10);
}

/** Only PENDING terms with a validated deadline_date are drawn on a day. */
export interface CalendarTerm {
  id: string;
  work_item_id: string;
  status: string;
  deadline_date: string;
  label: string | null;
  deadline_type: string | null;
  radicado?: string | null;
  despacho?: string | null;
  work_item_title?: string | null;
}

export interface CalendarHearing {
  id: string;
  title: string;
  scheduled_at: string;
  location: string | null;
  is_virtual: boolean;
  virtual_link: string | null;
  teams_link?: string | null;
  notes: string | null;
  work_item_id: string | null;
  work_item_title?: string | null;
  status?: string | null;
  radicado?: string | null;
  despacho?: string | null;
  duration_minutes?: number | null;
}

interface HearingsCalendarProps {
  hearings: CalendarHearing[];
  terms?: CalendarTerm[];
  onDelete?: (id: string) => void;
}

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1; // Monday = 0
}

export function HearingsCalendar({ hearings, terms = [], onDelete }: HearingsCalendarProps) {
  const appBase = typeof window !== "undefined" ? window.location.origin : "https://andromeda.legal";
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const hearingsByDate = useMemo(() => {
    const map: Record<string, CalendarHearing[]> = {};
    for (const h of hearings) {
      const dateKey = bogotaDateKey(h.scheduled_at);
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(h);
    }
    return map;
  }, [hearings]);

  const termsByDate = useMemo(() => {
    const map: Record<string, CalendarTerm[]> = {};
    for (const t of terms) {
      if (t.status !== "PENDING" || !t.deadline_date) continue;
      (map[t.deadline_date] ??= []).push(t);
    }
    return map;
  }, [terms]);

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfWeek(currentYear, currentMonth);

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
    setSelectedDate(null);
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
    setSelectedDate(null);
  };

  const goToday = () => {
    setCurrentMonth(today.getMonth());
    setCurrentYear(today.getFullYear());
    setSelectedDate(null);
  };

  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const selectedHearings = selectedDate ? (hearingsByDate[selectedDate] || []) : [];
  const selectedTerms = selectedDate ? (termsByDate[selectedDate] || []) : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Calendar Grid */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={prevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <CardTitle className="text-lg min-w-[200px] text-center">
                {MONTHS[currentMonth]} {currentYear}
              </CardTitle>
              <Button variant="outline" size="icon" onClick={nextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={goToday}>
              Hoy
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1">
            {/* Empty leading cells */}
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="h-16" />
            ))}

            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayHearings = hearingsByDate[dateKey] || [];
              const dayTerms = termsByDate[dateKey] || [];
              const isToday = dateKey === todayKey;
              const isSelected = dateKey === selectedDate;
              const hasFuture = dayHearings.some(h => new Date(h.scheduled_at) >= today);

              return (
                <button
                  key={day}
                  onClick={() => setSelectedDate(isSelected ? null : dateKey)}
                  className={cn(
                    "h-16 rounded-lg border text-sm relative flex flex-col items-center justify-start pt-1 transition-colors",
                    "hover:bg-accent/50",
                    isToday && "border-primary bg-primary/5",
                    isSelected && "ring-2 ring-primary bg-primary/10",
                    !isToday && !isSelected && "border-border/50",
                  )}
                >
                  <span className={cn(
                    "text-xs font-medium",
                    isToday && "text-primary font-bold",
                  )}>
                    {day}
                  </span>
                  {dayTerms.length > 0 && (
                    <span className="mt-0.5 rounded px-1 text-[10px] font-medium bg-destructive/15 text-destructive">
                      {dayTerms.length} término{dayTerms.length > 1 ? "s" : ""}
                    </span>
                  )}
                  {dayHearings.length > 0 && (
                    <div className="flex gap-0.5 mt-1 flex-wrap justify-center">
                      {dayHearings.slice(0, 3).map((h) => (
                        <div
                          key={h.id}
                          className={cn(
                            "w-2 h-2 rounded-full",
                            new Date(h.scheduled_at) < today
                              ? "bg-muted-foreground/40"
                              : hasFuture ? "bg-primary" : "bg-warning",
                          )}
                        />
                      ))}
                      {dayHearings.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">+{dayHearings.length - 3}</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Day Detail Panel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarIcon className="h-4 w-4" />
            {selectedDate
              ? new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-CO', {
                  weekday: 'long', day: 'numeric', month: 'long',
                })
              : 'Seleccione un día'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!selectedDate ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Haga clic en un día del calendario para ver términos y audiencias.
            </p>
          ) : selectedHearings.length === 0 && selectedTerms.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No hay términos ni audiencias para este día.
            </p>
          ) : (
            <>
            {selectedTerms.map((t) => (
              <div key={t.id} className="p-3 rounded-lg border border-destructive/40 bg-destructive/5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-medium text-sm leading-tight">{t.label || t.deadline_type || "Término"}</h4>
                  {t.attribution && !["PROPIO", "CONTRAPARTE", "JUEZ"].includes(String(t.attribution).toUpperCase()) && (
                    <span className="text-xs text-muted-foreground">Atribución pendiente de validación</span>
                  )}
                  <Badge variant="destructive" className="text-[10px] shrink-0">Término</Badge>
                </div>
                {t.radicado && <p className="text-xs text-muted-foreground">{t.radicado}</p>}
                <div className="flex items-center justify-between gap-2 pt-1 border-t">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                    <Link to={`/app/work-items/${t.work_item_id}`}>
                      <Eye className="h-3 w-3 mr-1" />
                      {t.work_item_title || "Abrir asunto"}
                    </Link>
                  </Button>
                  <AddToCalendarMenu size="xs" event={termEvent(t, appBase)} />
                </div>
              </div>
            ))}
            {selectedHearings
              .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
              .map((h) => (
                <div key={h.id} className="p-3 rounded-lg border bg-card space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-medium text-sm leading-tight">{h.title}</h4>
                    <div className="flex gap-1 shrink-0">
                      <Badge className="text-[10px]">Audiencia</Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {h.is_virtual ? "Virtual" : "Presencial"}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(h.scheduled_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {h.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {h.location}
                      </span>
                    )}
                    {h.virtual_link && (
                      <a href={h.virtual_link} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary hover:underline">
                        <Video className="h-3 w-3" />
                        Enlace
                      </a>
                    )}
                    {h.teams_link && (
                      <a href={h.teams_link} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary hover:underline">
                        <Video className="h-3 w-3" />
                        {h.teams_link.includes('teams.microsoft') ? 'Teams' : h.teams_link.includes('meet.google') ? 'Meet' : h.teams_link.includes('zoom') ? 'Zoom' : 'Unirse'}
                      </a>
                    )}
                  </div>

                  {h.notes && (
                    <p className="text-xs text-muted-foreground italic">{h.notes}</p>
                  )}

                  <div className="flex items-center justify-between pt-1 border-t">
                    {h.work_item_id ? (
                      <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                        <Link to={`/app/work-items/${h.work_item_id}`}>
                          <Eye className="h-3 w-3 mr-1" />
                          {h.work_item_title || 'Ver proceso'}
                        </Link>
                      </Button>
                    ) : (
                      <span />
                    )}
                    <div className="flex items-center gap-1">
                      <AddToCalendarMenu size="xs" event={hearingEvent({ ...h, status: h.status ?? "scheduled" }, appBase)} />
                      {onDelete && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive"
                          onClick={() => onDelete(h.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
