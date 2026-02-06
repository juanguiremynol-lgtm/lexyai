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
import { HearingsCalendar, type CalendarHearing } from "@/components/hearings/HearingsCalendar";
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
      const { data, error } = await supabase
        .from("hearings")
        .select(`
          id, title, scheduled_at, location, is_virtual, virtual_link, notes,
          work_item_id, work_items ( title )
        `)
        .is("deleted_at", null)
        .order("scheduled_at", { ascending: true })
        .limit(500);

      if (error) throw error;

      return (data || []).map((h: any) => ({
        id: h.id,
        title: h.title,
        scheduled_at: h.scheduled_at,
        location: h.location,
        is_virtual: h.is_virtual,
        virtual_link: h.virtual_link,
        notes: h.notes,
        work_item_id: h.work_item_id,
        work_item_title: h.work_items?.title || null,
      })) as CalendarHearing[];
    },
  });

  const upcomingHearings = hearings?.filter((h) => h.scheduled_at >= now) || [];
  const pastHearings = hearings?.filter((h) => h.scheduled_at < now).reverse() || [];

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (hearingId: string) => {
      // Soft delete
      const { error } = await supabase
        .from("hearings")
        .update({ deleted_at: new Date().toISOString() })
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold">Audiencias</h1>
          <p className="text-muted-foreground">
            {upcomingHearings.length} próxima{upcomingHearings.length !== 1 ? "s" : ""} ·{" "}
            {pastHearings.length} pasada{pastHearings.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            <HearingsCalendar
              hearings={hearings || []}
              onDelete={(id) => setDeleteTarget(id)}
            />
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
                          <div className="flex items-start justify-between">
                            <div>
                              <CardTitle className="text-base">{hearing.title}</CardTitle>
                              {hearing.notes && <CardDescription className="mt-1">{hearing.notes}</CardDescription>}
                            </div>
                            <div className="flex items-center gap-2">
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
