/**
 * HearingsTab - Audiencias tab for WorkItemDetail
 * 
 * Lists, creates, edits, and deletes hearings linked to this work item
 */

import { useState, useMemo } from "react";
import { format, isPast, isToday, isTomorrow, differenceInDays } from "date-fns";
import { es } from "date-fns/locale";
import { 
  Calendar, 
  Clock, 
  MapPin, 
  Video, 
  Plus, 
  Pencil, 
  Trash2, 
  ExternalLink,
  CalendarPlus,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { WorkItem } from "@/types/work-item";
import { 
  useWorkItemHearings, 
  useCreateHearing, 
  useUpdateHearing, 
  useDeleteHearing,
  type Hearing,
} from "@/hooks/use-work-item-hearings";

interface HearingsTabProps {
  workItem: WorkItem;
}

interface HearingFormData {
  title: string;
  scheduled_at: string;
  scheduled_time: string;
  location: string;
  notes: string;
  is_virtual: boolean;
  virtual_link: string;
}

const INITIAL_FORM_DATA: HearingFormData = {
  title: "",
  scheduled_at: "",
  scheduled_time: "08:00",
  location: "",
  notes: "",
  is_virtual: false,
  virtual_link: "",
};

function getStatusBadge(scheduledAt: string) {
  const date = new Date(scheduledAt);
  
  if (isPast(date) && !isToday(date)) {
    return <Badge variant="secondary">Pasada</Badge>;
  }
  
  if (isToday(date)) {
    return <Badge variant="destructive" className="animate-pulse">Hoy</Badge>;
  }
  
  if (isTomorrow(date)) {
    return <Badge className="bg-accent text-accent-foreground">Mañana</Badge>;
  }
  
  const daysUntil = differenceInDays(date, new Date());
  
  if (daysUntil <= 3) {
    return <Badge className="bg-accent text-accent-foreground">En {daysUntil} días</Badge>;
  }
  
  if (daysUntil <= 7) {
    return <Badge variant="outline">Próxima semana</Badge>;
  }
  
  return <Badge variant="outline">Programada</Badge>;
}

export function HearingsTab({ workItem }: HearingsTabProps) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingHearing, setEditingHearing] = useState<Hearing | null>(null);
  const [deletingHearing, setDeletingHearing] = useState<Hearing | null>(null);
  const [showPastHearings, setShowPastHearings] = useState(false);
  const [formData, setFormData] = useState<HearingFormData>(INITIAL_FORM_DATA);
  
  const { data: hearings, isLoading } = useWorkItemHearings(workItem.id);
  const createMutation = useCreateHearing();
  const updateMutation = useUpdateHearing();
  const deleteMutation = useDeleteHearing();
  
  // Separate upcoming and past hearings
  const { upcomingHearings, pastHearings } = useMemo(() => {
    if (!hearings) return { upcomingHearings: [], pastHearings: [] };
    
    const now = new Date();
    const upcoming = hearings.filter(h => new Date(h.scheduled_at) >= now || isToday(new Date(h.scheduled_at)));
    const past = hearings.filter(h => new Date(h.scheduled_at) < now && !isToday(new Date(h.scheduled_at)));
    
    return { 
      upcomingHearings: upcoming, 
      pastHearings: past.sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime()) 
    };
  }, [hearings]);
  
  const openCreateForm = () => {
    setFormData(INITIAL_FORM_DATA);
    setEditingHearing(null);
    setIsFormOpen(true);
  };
  
  const openEditForm = (hearing: Hearing) => {
    const date = new Date(hearing.scheduled_at);
    setFormData({
      title: hearing.title,
      scheduled_at: format(date, "yyyy-MM-dd"),
      scheduled_time: format(date, "HH:mm"),
      location: hearing.location || "",
      notes: hearing.notes || "",
      is_virtual: hearing.is_virtual || false,
      virtual_link: hearing.virtual_link || "",
    });
    setEditingHearing(hearing);
    setIsFormOpen(true);
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const scheduledAt = new Date(`${formData.scheduled_at}T${formData.scheduled_time}`).toISOString();
    
    if (editingHearing) {
      updateMutation.mutate({
        id: editingHearing.id,
        title: formData.title,
        scheduled_at: scheduledAt,
        location: formData.location,
        is_virtual: formData.is_virtual,
        virtual_link: formData.virtual_link,
        notes: formData.notes,
      }, {
        onSuccess: () => {
          setIsFormOpen(false);
          setEditingHearing(null);
        },
      });
    } else {
      createMutation.mutate({
        work_item_id: workItem.id,
        title: formData.title,
        scheduled_at: scheduledAt,
        location: formData.location,
        is_virtual: formData.is_virtual,
        virtual_link: formData.virtual_link,
        notes: formData.notes,
      }, {
        onSuccess: () => {
          setIsFormOpen(false);
        },
      });
    }
  };
  
  const handleDelete = () => {
    if (!deletingHearing) return;
    deleteMutation.mutate(deletingHearing, {
      onSuccess: () => setDeletingHearing(null),
    });
  };
  
  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Audiencias programadas</h3>
          <p className="text-sm text-muted-foreground">
            {upcomingHearings.length === 0 
              ? "No hay audiencias próximas" 
              : `${upcomingHearings.length} audiencia${upcomingHearings.length > 1 ? 's' : ''} próxima${upcomingHearings.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <Button onClick={openCreateForm} className="gap-2">
          <Plus className="h-4 w-4" />
          Nueva audiencia
        </Button>
      </div>
      
      {/* Empty state */}
      {hearings?.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CalendarPlus className="h-12 w-12 text-muted-foreground mb-4" />
            <h4 className="text-lg font-medium mb-2">No hay audiencias programadas</h4>
            <p className="text-sm text-muted-foreground mb-4 max-w-sm">
              Programa las audiencias de este proceso para recibir recordatorios automáticos.
            </p>
            <Button onClick={openCreateForm} variant="outline" className="gap-2">
              <CalendarPlus className="h-4 w-4" />
              Programar audiencia
            </Button>
          </CardContent>
        </Card>
      )}
      
      {/* Upcoming hearings */}
      {upcomingHearings.length > 0 && (
        <div className="space-y-3">
          {upcomingHearings.map((hearing) => (
            <HearingCard
              key={hearing.id}
              hearing={hearing}
              onEdit={() => openEditForm(hearing)}
              onDelete={() => setDeletingHearing(hearing)}
            />
          ))}
        </div>
      )}
      
      {/* Past hearings toggle */}
      {pastHearings.length > 0 && (
        <div className="space-y-3">
          <Button 
            variant="ghost" 
            className="w-full justify-start text-muted-foreground"
            onClick={() => setShowPastHearings(!showPastHearings)}
          >
            <Clock className="h-4 w-4 mr-2" />
            {showPastHearings ? "Ocultar" : "Ver"} audiencias pasadas ({pastHearings.length})
          </Button>
          
          {showPastHearings && (
            <div className="space-y-3 opacity-75">
              {pastHearings.map((hearing) => (
                <HearingCard
                  key={hearing.id}
                  hearing={hearing}
                  onEdit={() => openEditForm(hearing)}
                  onDelete={() => setDeletingHearing(hearing)}
                  isPast
                />
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* Create/Edit Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              {editingHearing ? "Editar audiencia" : "Programar audiencia"}
            </DialogTitle>
            <DialogDescription>
              {workItem.radicado && (
                <span>Proceso: <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{workItem.radicado}</code></span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Título de la audiencia *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Ej: Audiencia Inicial, Audiencia de Juzgamiento"
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="date">Fecha *</Label>
                <Input
                  id="date"
                  type="date"
                  value={formData.scheduled_at}
                  onChange={(e) => setFormData({ ...formData, scheduled_at: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="time">Hora *</Label>
                <Input
                  id="time"
                  type="time"
                  value={formData.scheduled_time}
                  onChange={(e) => setFormData({ ...formData, scheduled_time: e.target.value })}
                  required
                />
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <Switch
                id="is_virtual"
                checked={formData.is_virtual}
                onCheckedChange={(checked) => setFormData({ ...formData, is_virtual: checked })}
              />
              <Label htmlFor="is_virtual" className="flex items-center gap-2 cursor-pointer">
                <Video className="h-4 w-4" />
                Audiencia virtual
              </Label>
            </div>
            
            {formData.is_virtual ? (
              <div className="space-y-2">
                <Label htmlFor="virtual_link">Enlace de la reunión</Label>
                <Input
                  id="virtual_link"
                  type="url"
                  value={formData.virtual_link}
                  onChange={(e) => setFormData({ ...formData, virtual_link: e.target.value })}
                  placeholder="https://teams.microsoft.com/..."
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="location" className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Ubicación
                </Label>
                <Input
                  id="location"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="Ej: Palacio de Justicia, Sala 301"
                />
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="notes">Notas</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Observaciones adicionales..."
                rows={2}
              />
            </div>
            
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                <Calendar className="h-4 w-4 mr-2" />
                {editingHearing ? "Guardar cambios" : "Programar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      
      {/* Delete confirmation */}
      <AlertDialog open={!!deletingHearing} onOpenChange={(open) => !open && setDeletingHearing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              ¿Eliminar audiencia?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará la audiencia <strong>"{deletingHearing?.title}"</strong> programada para{" "}
              <strong>{deletingHearing && format(new Date(deletingHearing.scheduled_at), "PPP 'a las' p", { locale: es })}</strong>.
              <br /><br />
              También se eliminarán los recordatorios asociados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
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

interface HearingCardProps {
  hearing: Hearing;
  onEdit: () => void;
  onDelete: () => void;
  isPast?: boolean;
}

function HearingCard({ hearing, onEdit, onDelete, isPast }: HearingCardProps) {
  const date = new Date(hearing.scheduled_at);
  
  return (
    <Card className={cn(isPast && "border-muted bg-muted/30")}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h4 className="font-medium">{hearing.title}</h4>
              {getStatusBadge(hearing.scheduled_at)}
              {hearing.auto_detected && (
                <Badge variant="outline" className="text-xs">
                  Auto-detectada
                </Badge>
              )}
            </div>
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                {format(date, "EEEE d 'de' MMMM, yyyy", { locale: es })}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                {format(date, "h:mm a")}
              </span>
            </div>
            
            {(hearing.location || hearing.is_virtual) && (
              <div className="mt-2 text-sm">
                {hearing.is_virtual ? (
                  <span className="flex items-center gap-1.5 text-primary">
                    <Video className="h-4 w-4" />
                    Audiencia virtual
                    {hearing.virtual_link && (
                      <a 
                        href={hearing.virtual_link} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 underline hover:no-underline ml-1"
                      >
                        Abrir enlace <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    {hearing.location}
                  </span>
                )}
              </div>
            )}
            
            {hearing.notes && (
              <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                {hearing.notes}
              </p>
            )}
          </div>
          
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} className="text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
