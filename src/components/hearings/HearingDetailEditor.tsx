/**
 * HearingDetailEditor — Right panel: selected hearing editor
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Calendar, Clock, MapPin, Video, Users, FileText, Trash2, Save, Scale } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { WorkItemHearing } from "@/hooks/use-work-item-hearings-v2";
import { useUpdateWorkItemHearing, useDeleteWorkItemHearing, HEARING_STATUS_LABELS } from "@/hooks/use-work-item-hearings-v2";
import { HearingKeyMoments } from "./HearingKeyMoments";
import { HearingArtifactsSection } from "./HearingArtifactsSection";
import { HearingAIInsights } from "./HearingAIInsights";

interface Props {
  hearing: WorkItemHearing;
}

export function HearingDetailEditor({ hearing }: Props) {
  const updateMutation = useUpdateWorkItemHearing();
  const deleteMutation = useDeleteWorkItemHearing();

  const [status, setStatus] = useState(hearing.status);
  const [scheduledAt, setScheduledAt] = useState(hearing.scheduled_at || "");
  const [occurredAt, setOccurredAt] = useState(hearing.occurred_at || "");
  const [durationMinutes, setDurationMinutes] = useState(hearing.duration_minutes?.toString() || "");
  const [modality, setModality] = useState(hearing.modality || "");
  const [location, setLocation] = useState(hearing.location || "");
  const [meetingLink, setMeetingLink] = useState(hearing.meeting_link || "");
  const [decisionsSummary, setDecisionsSummary] = useState(hearing.decisions_summary || "");
  const [notesText, setNotesText] = useState(hearing.notes_plain_text || "");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const name = hearing.custom_name || hearing.hearing_type?.short_name || "Audiencia";
  const legalBasis = hearing.hearing_type?.legal_basis;
  const typicalPurpose = hearing.hearing_type?.typical_purpose;

  const handleSave = () => {
    updateMutation.mutate({
      id: hearing.id,
      work_item_id: hearing.work_item_id,
      organization_id: hearing.organization_id,
      status,
      scheduled_at: scheduledAt || undefined,
      occurred_at: occurredAt || undefined,
      duration_minutes: durationMinutes ? parseInt(durationMinutes) : undefined,
      modality: modality || undefined,
      location: location || undefined,
      meeting_link: meetingLink || undefined,
      decisions_summary: decisionsSummary || undefined,
      notes_rich_text: notesText || undefined,
      notes_plain_text: notesText || undefined,
    });
  };

  const handleDelete = () => {
    deleteMutation.mutate({
      id: hearing.id,
      work_item_id: hearing.work_item_id,
      organization_id: hearing.organization_id,
    });
    setDeleteOpen(false);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            {name}
          </h2>
          {legalBasis && (
            <p className="text-sm text-muted-foreground">{legalBasis}</p>
          )}
          {typicalPurpose && (
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-xl">{typicalPurpose}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
            <Save className="h-4 w-4 mr-1" />
            Guardar
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Metadata */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Información General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Estado</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(HEARING_STATUS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Modalidad</Label>
              <Select value={modality} onValueChange={setModality}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="presencial">Presencial</SelectItem>
                  <SelectItem value="virtual">Virtual</SelectItem>
                  <SelectItem value="mixta">Mixta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" /> Fecha programada
              </Label>
              <Input
                type="datetime-local"
                value={scheduledAt ? scheduledAt.slice(0, 16) : ""}
                onChange={(e) => setScheduledAt(e.target.value ? new Date(e.target.value).toISOString() : "")}
              />
            </div>
            <div>
              <Label className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> Fecha celebración
              </Label>
              <Input
                type="datetime-local"
                value={occurredAt ? occurredAt.slice(0, 16) : ""}
                onChange={(e) => setOccurredAt(e.target.value ? new Date(e.target.value).toISOString() : "")}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Duración (min)</Label>
              <Input
                type="number"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                placeholder="120"
              />
            </div>
            <div>
              <Label className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> Lugar
              </Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Juzgado / Sala" />
            </div>
            <div>
              <Label className="flex items-center gap-1">
                <Video className="h-3.5 w-3.5" /> Enlace virtual
              </Label>
              <Input value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} placeholder="https://..." />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Decisions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Decisiones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={decisionsSummary}
            onChange={(e) => setDecisionsSummary(e.target.value)}
            placeholder="Resumen de las decisiones tomadas en la audiencia..."
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Notas</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notesText}
            onChange={(e) => setNotesText(e.target.value)}
            placeholder="Notas detalladas de la audiencia..."
            rows={6}
          />
        </CardContent>
      </Card>

      {/* Key Moments */}
      <HearingKeyMoments
        hearingId={hearing.id}
        workItemId={hearing.work_item_id}
        organizationId={hearing.organization_id}
        keyMoments={hearing.key_moments || []}
        onUpdate={(moments) => {
          updateMutation.mutate({
            id: hearing.id,
            work_item_id: hearing.work_item_id,
            organization_id: hearing.organization_id,
            key_moments: moments,
          });
        }}
      />

      {/* Artifacts */}
      <HearingArtifactsSection
        hearingId={hearing.id}
        organizationId={hearing.organization_id}
        workItemId={hearing.work_item_id}
      />

      {/* AI Insights */}
      <HearingAIInsights
        hearingId={hearing.id}
        organizationId={hearing.organization_id}
        hasContent={!!(hearing.notes_plain_text || hearing.decisions_summary)}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar audiencia?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán las notas, archivos y momentos clave asociados. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
