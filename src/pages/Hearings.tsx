/**
 * Hearings Page — Calendar + List view with CRUD and alert integration.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Calendar, Clock, MapPin, Video, Eye, Plus, CalendarDays, List, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { HearingsCalendar, type CalendarHearing, type CalendarTerm } from "@/components/hearings/HearingsCalendar";
import { AddToCalendarMenu } from "@/components/calendar/AddToCalendarMenu";
import { hearingEvent } from "@/lib/calendar-export";

const LIVE_HEARING_STATUSES = ["scheduled", "planned", "rescheduled", "confirmed"];

const HEARING_LIST_STATUS_LABELS: Record<string, string> = {
  scheduled: "Programada",
  planned: "Planificada",
  rescheduled: "Reprogramada",
  confirmed: "Confirmada",
  held: "Celebrada",
  postponed: "Aplazada",
  cancelled: "Cancelada",
  suspended: "Suspendida",
};
import { NewHearingDialog } from "@/components/hearings/NewHearingDialog";
import { cancelHearingAlerts } from "@/lib/hearing-alerts";

type ViewMode = "calendar" | "list";

export default function Hearings() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [listTab, setListTab] = useState<"upcoming" | "past">("upcoming");
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const now = new Date().toISOString();

  // Fetch all hearings (for calendar we need all; list filters client-side)
  const { data: hearings, isLoading } = useQuery({
    queryKey: ["hearings"],
    queryFn: async () => {
      // Reads from the CANONICAL work_item_hearings table.
      const { data, error } = await supabase
        .from("work_item_hearings")
        .select(
          `id, custom_name, scheduled_at, occurred_at, location, modality,
           meeting_link, notes_plain_text, work_item_id, status, duration_minutes,
           hearing_types(name), work_items ( title, radicado, authority_name )`
        )
        .not("scheduled_at", "is", null)
        .order("scheduled_at", { ascending: true })
        .limit(500);

      if (error) throw error;

      return (data || []).map((h: any) => {
        const isVirtual = h.modality === "virtual" || h.modality === "mixta";
        return {
          id: h.id,
          title: h.custom_name || h.hearing_types?.name || "Audiencia",
          scheduled_at: h.scheduled_at,
          location: h.location,
          is_virtual: isVirtual,
          virtual_link: isVirtual ? h.meeting_link : null,
          notes: h.notes_plain_text,
          work_item_id: h.work_item_id,
          work_item_title: h.work_items?.title || null,
          status: h.status,
          radicado: h.work_items?.radicado || null,
          despacho: h.work_items?.authority_name || null,
          duration_minutes: h.duration_minutes ?? null,
        };
      }) as CalendarHearing[];
    },
  });

  // Terms: only PENDING with a validated date are drawn on a day. Manual-review
  // records are listed apart, without a date.
  const { data: termData } = useQuery({
    queryKey: ["calendar-terms"],
    queryFn: async () => {
      const cols = "id, work_item_id, status, deadline_date, label, deadline_type, work_items ( title, radicado, authority_name )";
      const [pending, manual] = await Promise.all([
        supabase.from("work_item_deadlines").select(cols).eq("status", "PENDING").not("deadline_date", "is", null).limit(500),
        supabase.from("work_item_deadlines").select(cols).eq("status", "REQUIERE_REVISION_MANUAL").limit(200),
      ]);
      if (pending.error) throw pending.error;
      if (manual.error) throw manual.error;
      // Attribution comes only from v_deadline_attribution (never re-derived).
      const ids = (pending.data ?? []).map((r: any) => r.id);
      const attr = new Map<string, string>();
      if (ids.length) {
        const { data: av } = await (supabase as any).from("v_deadline_attribution")
          .select("deadline_id, attribution").in("deadline_id", ids);
        for (const a of (av ?? []) as any[]) attr.set(a.deadline_id, a.attribution);
      }
      const map = (r: any): CalendarTerm => ({
        attribution: attr.get(r.id) ?? null,
        id: r.id, work_item_id: r.work_item_id, status: r.status, deadline_date: r.deadline_date,
        label: r.label, deadline_type: r.deadline_type, radicado: r.work_items?.radicado ?? null,
        despacho: r.work_items?.authority_name ?? null, work_item_title: r.work_items?.title ?? null,
      });
      return { pending: (pending.data ?? []).map(map), manual: (manual.data ?? []).map(map) };
    },
  });
  const appBase = window.location.origin;

  // Upcoming = future-dated hearings that are still on. Postponed, cancelled and
  // suspended hearings are never "upcoming", no matter their scheduled_at.
  const isLiveStatus = (s: string | null | undefined) => LIVE_HEARING_STATUSES.includes(String(s ?? ""));
  const upcomingHearings = (hearings || []).filter((h) => h.scheduled_at >= now && isLiveStatus(h.status));
  // Everything else (past-dated hearings, or non-live ones at any date) is listed
  // as history with an explicit status badge so nothing looks silently active.
  const pastHearings = (hearings || [])
    .filter((h) => !(h.scheduled_at >= now && isLiveStatus(h.status)))
    .sort((a, b) => (b.scheduled_at || "").localeCompare(a.scheduled_at || ""));

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (hearingId: string) => {
      // work_item_hearings doesn't support soft-delete → hard delete.
      const { error } = await supabase
        .from("work_item_hearings")
        .delete()
        .eq("id", hearingId);
      if (error) throw error;

      // Cancel associated alerts
      await cancelHearingAlerts(hearingId);
    },
    onSuccess: () => {
      toast.success("Audiencia eliminada");
      queryClient.invalidateQueries({ queryKey: ["hearings"] });
      setDeleteTarget(null);
    },
    onError: () => {
      toast.error("Error al eliminar la audiencia");
    },
  });

  const listItems = listTab === "upcoming" ? upcomingHearings : pastHearings;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold">Audiencias</h1>
          <p className="text-muted-foreground">
            {upcomingHearings.length} próxima{upcomingHearings.length !== 1 ? "s" : ""} ·{" "}
            {pastHearings.length} pasada{pastHearings.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* View Toggle */}
          <div className="flex rounded-lg border bg-muted/30 p-0.5">
            <Button
              variant={viewMode === "calendar" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("calendar")}
              className="h-8"
            >
              <CalendarDays className="h-4 w-4 mr-1" />
              Calendario
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
              className="h-8"
            >
              <List className="h-4 w-4 mr-1" />
              Lista
            </Button>
          </div>

          <Button onClick={() => setNewDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Nueva Audiencia
          </Button>
        </div>
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-[500px] lg:col-span-2" />
          <Skeleton className="h-[500px]" />
        </div>
      ) : (
        <>
          {/* Calendar View */}
          {viewMode === "calendar" && (
            <div className="space-y-6">
              <HearingsCalendar
                hearings={(hearings || []).filter((h) => LIVE_HEARING_STATUSES.includes(String(h.status)))}
                terms={termData?.pending ?? []}
                onDelete={(id) => setDeleteTarget(id)}
              />
              {(termData?.manual.length ?? 0) > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Pendientes de validación ({termData!.manual.length})</CardTitle>
                    <CardDescription>
                      TÉRMINOS EN REVISIÓN MANUAL — clasificación o cómputo pendientes de validación. Estos registros no se presentan como términos activos ni vencidos mientras Andromeda no cuente con evidencia suficiente para validar su clasificación, ancla y fecha de vencimiento.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-2">
                    {termData!.manual.map((t) => (
                      <Link key={t.id} to={`/app/work-items/${t.work_item_id}`}
                         className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border p-2 text-sm hover:bg-accent/50">
                         <span className="min-w-0 break-all">
                          <span className="font-medium">{t.label || t.deadline_type}</span>
                          {t.radicado && <span className="text-muted-foreground"> · {t.radicado}</span>}
                        </span>
                        <Badge variant="outline" className="shrink-0">Sin fecha validada</Badge>
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* List View */}
          {viewMode === "list" && (
            <Tabs value={listTab} onValueChange={(v) => setListTab(v as "upcoming" | "past")}>
              <TabsList>
                <TabsTrigger value="upcoming">
                  Próximas ({upcomingHearings.length})
                </TabsTrigger>
                <TabsTrigger value="past">
                  Pasadas ({pastHearings.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value={listTab} className="mt-4">
                {listItems.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Calendar className="mx-auto h-12 w-12 mb-4 opacity-50" />
                    <p>No hay audiencias {listTab === "upcoming" ? "próximas" : "pasadas"}</p>
                    {listTab === "upcoming" && (
                      <Button variant="outline" className="mt-4" onClick={() => setNewDialogOpen(true)}>
                        <Plus className="h-4 w-4 mr-1" />
                        Programar audiencia
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {listItems.map((hearing) => (
                      <Card key={hearing.id}>
                        <CardHeader className="pb-2">
                           <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                             <div className="min-w-0">
                               <CardTitle className="break-words text-base">{hearing.title}</CardTitle>
                               {hearing.notes && <CardDescription className="mt-1 break-words">{hearing.notes}</CardDescription>}
                            </div>
                             <div className="flex flex-wrap items-center gap-2">
                              {isLiveStatus(hearing.status) && (
                                <AddToCalendarMenu event={hearingEvent(hearing, appBase)} />
                              )}
                              <Badge
                                variant={
                                  hearing.status === "cancelled" || hearing.status === "suspended"
                                    ? "destructive"
                                    : hearing.status === "postponed"
                                      ? "outline"
                                      : "secondary"
                                }
                              >
                                {HEARING_LIST_STATUS_LABELS[hearing.status || ""] || "Audiencia"}
                              </Badge>
                              <Badge variant={hearing.is_virtual ? "default" : "secondary"}>
                                {hearing.is_virtual ? "Virtual" : "Presencial"}
                              </Badge>
                              <Button
                                variant="ghost" size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setDeleteTarget(hearing.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              {new Date(hearing.scheduled_at).toLocaleDateString("es-CO", {
                                weekday: "short", year: "numeric", month: "short", day: "numeric",
                              })}
                            </div>
                            <div className="flex items-center gap-1">
                              <Clock className="h-4 w-4" />
                              {new Date(hearing.scheduled_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                            {hearing.location && (
                              <div className="flex items-center gap-1">
                                <MapPin className="h-4 w-4" />
                                {hearing.location}
                              </div>
                            )}
                            {hearing.virtual_link && (
                              <a href={hearing.virtual_link} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 text-primary hover:underline">
                                <Video className="h-4 w-4" />
                                Enlace virtual
                              </a>
                            )}
                          </div>
                          {hearing.work_item_id && (
                            <div className="mt-3 pt-3 border-t flex items-center gap-2">
                              <Button variant="ghost" size="sm" asChild>
                                <Link to={`/app/work-items/${hearing.work_item_id}`}>
                                  <Eye className="h-4 w-4 mr-1" />
                                  {hearing.work_item_title || "Ver proceso"}
                                </Link>
                              </Button>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </>
      )}

      {/* New Hearing Dialog */}
      <NewHearingDialog open={newDialogOpen} onOpenChange={setNewDialogOpen} />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar audiencia?</AlertDialogTitle>
            <AlertDialogDescription>
              Se cancelarán todas las alertas y recordatorios asociados. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
