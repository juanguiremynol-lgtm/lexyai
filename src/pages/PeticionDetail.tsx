import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Clock,
  FileText,
  Save,
  Trash2,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ExternalLink,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateColombia } from "@/lib/constants";
import { PETICION_PHASES, PETICION_PHASES_ORDER, ENTITY_TYPES, type PeticionPhase } from "@/lib/peticiones-constants";
import { EntityClientLink } from "@/components/shared";

export default function PeticionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fetch petición details
  const { data: peticion, isLoading } = useQuery({
    queryKey: ["peticion", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("peticiones")
        .select("*, clients(id, name)")
        .eq("id", id!)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Update petición mutation
  const updatePeticion = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const { error } = await supabase
        .from("peticiones")
        .update(updates)
        .eq("id", id!);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["peticion", id] });
      toast.success("Petición actualizada");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Delete petición mutation
  const deletePeticion = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("peticiones")
        .delete()
        .eq("id", id!);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Petición eliminada");
      navigate("/dashboard");
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    updatePeticion.mutate({
      entity_name: form.get("entity_name"),
      entity_email: form.get("entity_email"),
      entity_address: form.get("entity_address"),
      entity_type: form.get("entity_type"),
      subject: form.get("subject"),
      description: form.get("description"),
      radicado: form.get("radicado"),
      notes: form.get("notes"),
    });
  };

  const handlePhaseChange = (newPhase: PeticionPhase) => {
    updatePeticion.mutate({ phase: newPhase });
  };

  const getDaysRemaining = () => {
    if (!peticion?.deadline_at) return null;
    const deadline = new Date(peticion.deadline_at);
    const now = new Date();
    const diffTime = deadline.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const daysRemaining = getDaysRemaining();
  const isOverdue = daysRemaining !== null && daysRemaining < 0;
  const isUrgent = daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 3;
  const client = peticion?.clients as { id: string; name: string } | null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!peticion) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Petición no encontrada</p>
        <Button asChild className="mt-4">
          <Link to="/dashboard">Volver al Dashboard</Link>
        </Button>
      </div>
    );
  }

  const phaseConfig = PETICION_PHASES[peticion.phase as PeticionPhase];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/dashboard">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-serif font-bold truncate">
              {peticion.subject}
            </h1>
            <Badge variant={phaseConfig?.color === "emerald" ? "default" : "secondary"}>
              {phaseConfig?.shortLabel || peticion.phase}
            </Badge>
          </div>
          <p className="text-muted-foreground">{peticion.entity_name}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={peticion.phase}
            onValueChange={(v) => handlePhaseChange(v as PeticionPhase)}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PETICION_PHASES_ORDER.map((phase) => (
                <SelectItem key={phase} value={phase}>
                  {PETICION_PHASES[phase].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="icon" className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar petición?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acción eliminará permanentemente esta petición.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deletePeticion.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Client Alert */}
      {!client && (
        <Alert variant="destructive" className="bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-800 dark:text-amber-300">
            Cliente No Asignado
          </AlertTitle>
          <AlertDescription className="text-amber-700 dark:text-amber-400">
            Esta petición no tiene un cliente asignado. Vincule un cliente para un mejor seguimiento.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-muted-foreground" />
            <Label className="text-sm font-medium">Cliente:</Label>
            <EntityClientLink
              entityType="peticion"
              entityId={peticion.id}
              entityLabel={`Petición: ${peticion.subject}`}
              currentClientId={client?.id}
              currentClientName={client?.name}
              onLinked={() => queryClient.invalidateQueries({ queryKey: ["peticion", id] })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Deadline Status */}
      {peticion.deadline_at && (
        <Card className={isOverdue ? "border-destructive bg-destructive/5" : isUrgent ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20" : ""}>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock className={`h-5 w-5 ${isOverdue ? "text-destructive" : isUrgent ? "text-amber-600" : "text-muted-foreground"}`} />
                <div>
                  <p className="font-medium">
                    {isOverdue ? "Plazo Vencido" : isUrgent ? "Plazo Próximo a Vencer" : "Plazo de Respuesta"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatDateColombia(peticion.deadline_at)}
                    {daysRemaining !== null && (
                      <span className={`ml-2 ${isOverdue ? "text-destructive" : isUrgent ? "text-amber-600" : ""}`}>
                        ({isOverdue ? `${Math.abs(daysRemaining)} días vencido` : `${daysRemaining} días restantes`})
                      </span>
                    )}
                  </p>
                </div>
              </div>
              {peticion.prorogation_requested && peticion.prorogation_deadline_at && (
                <Badge variant="outline" className="gap-1">
                  <Calendar className="h-3 w-3" />
                  Prórroga: {formatDateColombia(peticion.prorogation_deadline_at)}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Información de la Petición</CardTitle>
              <CardDescription>Datos de la entidad y contenido de la petición</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleFormSubmit} className="space-y-6">
                {/* Entity Info */}
                <div className="space-y-4">
                  <h3 className="font-medium flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Entidad
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 space-y-2">
                      <Label htmlFor="entity_name">Nombre de la Entidad</Label>
                      <Input
                        id="entity_name"
                        name="entity_name"
                        defaultValue={peticion.entity_name}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="entity_type">Tipo de Entidad</Label>
                      <Select name="entity_type" defaultValue={peticion.entity_type || "PUBLIC"}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(ENTITY_TYPES).map(([key, label]) => (
                            <SelectItem key={key} value={key}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="entity_email">Correo de la Entidad</Label>
                      <Input
                        id="entity_email"
                        name="entity_email"
                        type="email"
                        defaultValue={peticion.entity_email || ""}
                        placeholder="correo@entidad.gov.co"
                      />
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label htmlFor="entity_address">Dirección</Label>
                      <Input
                        id="entity_address"
                        name="entity_address"
                        defaultValue={peticion.entity_address || ""}
                        placeholder="Dirección de la entidad"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Petition Content */}
                <div className="space-y-4">
                  <h3 className="font-medium flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Contenido
                  </h3>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="subject">Asunto</Label>
                      <Input
                        id="subject"
                        name="subject"
                        defaultValue={peticion.subject}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Descripción</Label>
                      <Textarea
                        id="description"
                        name="description"
                        defaultValue={peticion.description || ""}
                        placeholder="Descripción detallada de la petición..."
                        rows={4}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="radicado">Número de Radicado</Label>
                      <Input
                        id="radicado"
                        name="radicado"
                        defaultValue={peticion.radicado || ""}
                        placeholder="Radicado asignado por la entidad"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Notes */}
                <div className="space-y-2">
                  <Label htmlFor="notes">Notas Internas</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    defaultValue={peticion.notes || ""}
                    placeholder="Notas y observaciones..."
                    rows={3}
                  />
                </div>

                <Button type="submit" disabled={updatePeticion.isPending} className="w-full">
                  <Save className="h-4 w-4 mr-2" />
                  Guardar Cambios
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Timeline / Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Estado del Trámite</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {PETICION_PHASES_ORDER.map((phase, index) => {
                const config = PETICION_PHASES[phase];
                const isCurrentPhase = peticion.phase === phase;
                const isPastPhase = PETICION_PHASES_ORDER.indexOf(peticion.phase as PeticionPhase) > index;

                return (
                  <div
                    key={phase}
                    className={`flex items-start gap-3 p-3 rounded-lg ${
                      isCurrentPhase
                        ? "bg-primary/10 border border-primary/30"
                        : isPastPhase
                        ? "bg-muted/50"
                        : ""
                    }`}
                  >
                    <div className={`mt-0.5 ${isCurrentPhase ? "text-primary" : isPastPhase ? "text-green-600" : "text-muted-foreground"}`}>
                      {isPastPhase ? (
                        <CheckCircle className="h-5 w-5" />
                      ) : (
                        <div className={`w-5 h-5 rounded-full border-2 ${isCurrentPhase ? "border-primary bg-primary/20" : "border-muted-foreground/30"}`} />
                      )}
                    </div>
                    <div>
                      <p className={`font-medium ${isCurrentPhase ? "text-primary" : ""}`}>
                        {config.label}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {config.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Key Dates */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Fechas Clave</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Fecha de Radicación</p>
                <p className="font-medium">
                  {peticion.filed_at ? formatDateColombia(peticion.filed_at) : "No especificada"}
                </p>
              </div>
              {peticion.constancia_received_at && (
                <div>
                  <p className="text-sm text-muted-foreground">Constancia Recibida</p>
                  <p className="font-medium">{formatDateColombia(peticion.constancia_received_at)}</p>
                </div>
              )}
              {peticion.response_received_at && (
                <div>
                  <p className="text-sm text-muted-foreground">Respuesta Recibida</p>
                  <p className="font-medium">{formatDateColombia(peticion.response_received_at)}</p>
                </div>
              )}
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground">Creada</p>
                <p className="font-medium">{formatDateColombia(peticion.created_at)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Última Actualización</p>
                <p className="font-medium">{formatDateColombia(peticion.updated_at)}</p>
              </div>
            </CardContent>
          </Card>

          {/* Escalation */}
          {peticion.escalated_to_tutela && peticion.tutela_filing_id && (
            <Card className="border-amber-500">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-amber-600">
                  <AlertTriangle className="h-5 w-5" />
                  <span className="font-medium">Escalada a Tutela</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  asChild
                >
                  <Link to={`/filings/${peticion.tutela_filing_id}`}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Ver Tutela
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
