import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Calendar,
  Clock,
  MapPin,
  Video,
  Plus,
  Trash2,
  ExternalLink,
  Bot,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateColombia } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface HearingsListProps {
  filingId: string;
}

export function HearingsList({ filingId }: HearingsListProps) {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    scheduled_at: "",
    scheduled_time: "08:00",
    location: "",
    notes: "",
    is_virtual: false,
    virtual_link: "",
  });

  const { data: hearings, isLoading } = useQuery({
    queryKey: ["hearings", filingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hearings")
        .select("*")
        .eq("filing_id", filingId)
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const createHearing = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const scheduledAt = new Date(`${formData.scheduled_at}T${formData.scheduled_time}`);

      const { error } = await supabase.from("hearings").insert({
        filing_id: filingId,
        owner_id: user.id,
        title: formData.title,
        scheduled_at: scheduledAt.toISOString(),
        location: formData.location || null,
        notes: formData.notes || null,
        is_virtual: formData.is_virtual,
        virtual_link: formData.virtual_link || null,
        auto_detected: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hearings", filingId] });
      toast.success("Audiencia programada");
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const deleteHearing = useMutation({
    mutationFn: async (hearingId: string) => {
      const { error } = await supabase
        .from("hearings")
        .delete()
        .eq("id", hearingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hearings", filingId] });
      toast.success("Audiencia eliminada");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      title: "",
      scheduled_at: "",
      scheduled_time: "08:00",
      location: "",
      notes: "",
      is_virtual: false,
      virtual_link: "",
    });
  };

  const isUpcoming = (date: string) => new Date(date) > new Date();
  const isPast = (date: string) => new Date(date) < new Date();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Clock className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const upcomingHearings = hearings?.filter(h => isUpcoming(h.scheduled_at)) || [];
  const pastHearings = hearings?.filter(h => isPast(h.scheduled_at)) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Audiencias</h3>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Nueva Audiencia
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Programar Audiencia</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createHearing.mutate();
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="title">Título</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Ej: Audiencia inicial"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="date">Fecha</Label>
                  <Input
                    id="date"
                    type="date"
                    value={formData.scheduled_at}
                    onChange={(e) => setFormData({ ...formData, scheduled_at: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="time">Hora</Label>
                  <Input
                    id="time"
                    type="time"
                    value={formData.scheduled_time}
                    onChange={(e) => setFormData({ ...formData, scheduled_time: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="is_virtual"
                  checked={formData.is_virtual}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_virtual: checked })}
                />
                <Label htmlFor="is_virtual">Audiencia virtual</Label>
              </div>

              {formData.is_virtual ? (
                <div className="space-y-2">
                  <Label htmlFor="virtual_link">Enlace de la reunión</Label>
                  <Input
                    id="virtual_link"
                    type="url"
                    value={formData.virtual_link}
                    onChange={(e) => setFormData({ ...formData, virtual_link: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="location">Ubicación</Label>
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
                  placeholder="Notas adicionales..."
                  rows={3}
                />
              </div>

              <Button type="submit" className="w-full" disabled={createHearing.isPending}>
                <Calendar className="h-4 w-4 mr-2" />
                Programar Audiencia
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {upcomingHearings.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">Próximas</h4>
          {upcomingHearings.map((hearing) => (
            <HearingCard
              key={hearing.id}
              hearing={hearing}
              onDelete={() => deleteHearing.mutate(hearing.id)}
              isDeleting={deleteHearing.isPending}
            />
          ))}
        </div>
      )}

      {pastHearings.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">Pasadas</h4>
          {pastHearings.map((hearing) => (
            <HearingCard
              key={hearing.id}
              hearing={hearing}
              onDelete={() => deleteHearing.mutate(hearing.id)}
              isDeleting={deleteHearing.isPending}
              isPast
            />
          ))}
        </div>
      )}

      {hearings?.length === 0 && (
        <div className="text-center py-8">
          <Calendar className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-2 text-muted-foreground">
            No hay audiencias programadas
          </p>
        </div>
      )}
    </div>
  );
}

interface HearingCardProps {
  hearing: {
    id: string;
    title: string;
    scheduled_at: string;
    location: string | null;
    is_virtual: boolean | null;
    virtual_link: string | null;
    notes: string | null;
    auto_detected: boolean | null;
  };
  onDelete: () => void;
  isDeleting: boolean;
  isPast?: boolean;
}

function HearingCard({ hearing, onDelete, isDeleting, isPast }: HearingCardProps) {
  const date = new Date(hearing.scheduled_at);
  
  return (
    <div className={cn(
      "border rounded-lg p-4",
      isPast ? "bg-muted/50 opacity-75" : "bg-card"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h5 className="font-medium">{hearing.title}</h5>
            {hearing.auto_detected && (
              <Badge variant="outline" className="text-xs">
                <Bot className="h-3 w-3 mr-1" />
                Auto-detectada
              </Badge>
            )}
          </div>
          
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              {formatDateColombia(hearing.scheduled_at)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
            </span>
            
            {hearing.is_virtual ? (
              <span className="flex items-center gap-1">
                <Video className="h-4 w-4" />
                Virtual
              </span>
            ) : hearing.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {hearing.location}
              </span>
            )}
          </div>

          {hearing.notes && (
            <p className="mt-2 text-sm text-muted-foreground">{hearing.notes}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hearing.is_virtual && hearing.virtual_link && (
            <Button
              variant="outline"
              size="icon"
              asChild
            >
              <a href={hearing.virtual_link} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            disabled={isDeleting}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    </div>
  );
}
