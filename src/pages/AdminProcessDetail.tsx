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
  FileText,
  Save,
  Trash2,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ExternalLink,
  Users,
  Mail,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateColombia } from "@/lib/constants";
import { 
  ADMIN_PROCESS_PHASES, 
  ADMIN_PROCESS_PHASES_ORDER, 
  ADMIN_ACTUACION_TYPES,
  type AdminProcessPhase 
} from "@/lib/admin-constants";
import { EntityClientLink, SharepointHub } from "@/components/shared";

export default function AdminProcessDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fetch admin process details
  const { data: process, isLoading } = useQuery({
    queryKey: ["admin-process", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monitored_processes")
        .select(`
          *, 
          clients(id, name),
          linked_filing:filings!monitored_processes_linked_filing_id_fkey(
            id,
            matter:matters(id, matter_name, sharepoint_url, sharepoint_alerts_dismissed)
          )
        `)
        .eq("id", id!)
        .eq("process_type", "ADMINISTRATIVE")
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Update process mutation
  const updateProcess = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const { error } = await supabase
        .from("monitored_processes")
        .update(updates)
        .eq("id", id!);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-process", id] });
      toast.success("Proceso actualizado");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Delete process mutation
  const deleteProcess = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("monitored_processes")
        .delete()
        .eq("id", id!);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Proceso eliminado");
      navigate("/dashboard");
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    updateProcess.mutate({
      autoridad: form.get("autoridad"),
      entidad: form.get("entidad"),
      dependencia: form.get("dependencia"),
      correo_autoridad: form.get("correo_autoridad"),
      expediente_administrativo: form.get("expediente_administrativo"),
      tipo_actuacion: form.get("tipo_actuacion"),
      notes: form.get("notes"),
    });
  };

  const handlePhaseChange = (newPhase: AdminProcessPhase) => {
    updateProcess.mutate({ admin_phase: newPhase });
  };

  const client = process?.clients as { id: string; name: string } | null;
  const linkedFiling = process?.linked_filing as { 
    id: string; 
    matter: { id: string; matter_name: string; sharepoint_url: string | null; sharepoint_alerts_dismissed: boolean | null } | null 
  } | null;
  const matter = linkedFiling?.matter;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!process) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Proceso administrativo no encontrado</p>
        <Button asChild className="mt-4">
          <Link to="/dashboard">Volver al Dashboard</Link>
        </Button>
      </div>
    );
  }

  const currentPhase = (process.admin_phase as AdminProcessPhase) || "INICIO_APERTURA";
  const phaseConfig = ADMIN_PROCESS_PHASES[currentPhase];

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
              {process.autoridad || process.entidad || "Proceso Administrativo"}
            </h1>
            <Badge variant="secondary">
              {phaseConfig?.shortLabel || currentPhase}
            </Badge>
          </div>
          <p className="text-muted-foreground font-mono">
            {process.expediente_administrativo || process.radicado}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={currentPhase}
            onValueChange={(v) => handlePhaseChange(v as AdminProcessPhase)}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADMIN_PROCESS_PHASES_ORDER.map((phase) => (
                <SelectItem key={phase} value={phase}>
                  {ADMIN_PROCESS_PHASES[phase].label}
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
                <AlertDialogTitle>¿Eliminar proceso?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acción eliminará permanentemente este proceso administrativo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteProcess.mutate()}
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
            Este proceso no tiene un cliente asignado. Vincule un cliente para un mejor seguimiento.
          </AlertDescription>
        </Alert>
      )}

      {/* Client Link */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-muted-foreground" />
            <Label className="text-sm font-medium">Cliente:</Label>
            <EntityClientLink
              entityType="process"
              entityId={process.id}
              entityLabel={`Proceso: ${process.autoridad || process.radicado}`}
              currentClientId={client?.id}
              currentClientName={client?.name}
              onLinked={() => queryClient.invalidateQueries({ queryKey: ["admin-process", id] })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Sharepoint Hub */}
      {matter && (
        <SharepointHub
          matterId={matter.id}
          sharepointUrl={matter.sharepoint_url}
          alertsDismissed={matter.sharepoint_alerts_dismissed ?? false}
          matterName={matter.matter_name}
          onUpdate={() => queryClient.invalidateQueries({ queryKey: ["admin-process", id] })}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Información del Proceso</CardTitle>
              <CardDescription>Datos de la autoridad y expediente administrativo</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleFormSubmit} className="space-y-6">
                {/* Authority Info */}
                <div className="space-y-4">
                  <h3 className="font-medium flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Autoridad / Entidad
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 space-y-2">
                      <Label htmlFor="autoridad">Autoridad</Label>
                      <Input
                        id="autoridad"
                        name="autoridad"
                        defaultValue={process.autoridad || ""}
                        placeholder="Ej: Superintendencia de Industria y Comercio"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="entidad">Entidad</Label>
                      <Input
                        id="entidad"
                        name="entidad"
                        defaultValue={process.entidad || ""}
                        placeholder="Ej: SIC"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dependencia">Dependencia</Label>
                      <Input
                        id="dependencia"
                        name="dependencia"
                        defaultValue={process.dependencia || ""}
                        placeholder="Ej: Dirección de Investigaciones"
                      />
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label htmlFor="correo_autoridad">Correo de la Autoridad</Label>
                      <div className="flex gap-2">
                        <Mail className="h-4 w-4 mt-3 text-muted-foreground" />
                        <Input
                          id="correo_autoridad"
                          name="correo_autoridad"
                          type="email"
                          defaultValue={process.correo_autoridad || ""}
                          placeholder="notificaciones@entidad.gov.co"
                          className="flex-1"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Process Info */}
                <div className="space-y-4">
                  <h3 className="font-medium flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Expediente
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="expediente_administrativo">No. Expediente</Label>
                      <Input
                        id="expediente_administrativo"
                        name="expediente_administrativo"
                        defaultValue={process.expediente_administrativo || ""}
                        placeholder="Número de expediente"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tipo_actuacion">Tipo de Actuación</Label>
                      <Select name="tipo_actuacion" defaultValue={process.tipo_actuacion || ""}>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar tipo" />
                        </SelectTrigger>
                        <SelectContent>
                          {ADMIN_ACTUACION_TYPES.map((tipo) => (
                            <SelectItem key={tipo} value={tipo}>
                              {tipo}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Location */}
                {(process.department || process.municipality) && (
                  <>
                    <div className="space-y-4">
                      <h3 className="font-medium flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        Ubicación
                      </h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">Departamento</p>
                          <p className="font-medium">{process.department || "No especificado"}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Municipio</p>
                          <p className="font-medium">{process.municipality || "No especificado"}</p>
                        </div>
                      </div>
                    </div>
                    <Separator />
                  </>
                )}

                {/* Notes */}
                <div className="space-y-2">
                  <Label htmlFor="notes">Notas Internas</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    defaultValue={process.notes || ""}
                    placeholder="Notas y observaciones..."
                    rows={3}
                  />
                </div>

                <Button type="submit" disabled={updateProcess.isPending} className="w-full">
                  <Save className="h-4 w-4 mr-2" />
                  Guardar Cambios
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Phase Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Fase del Proceso</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {ADMIN_PROCESS_PHASES_ORDER.map((phase, index) => {
                const config = ADMIN_PROCESS_PHASES[phase];
                const isCurrentPhase = currentPhase === phase;
                const isPastPhase = ADMIN_PROCESS_PHASES_ORDER.indexOf(currentPhase) > index;

                return (
                  <div
                    key={phase}
                    className={`flex items-center gap-3 p-2 rounded-lg ${
                      isCurrentPhase
                        ? "bg-primary/10 border border-primary/30"
                        : isPastPhase
                        ? "bg-muted/50"
                        : ""
                    }`}
                  >
                    <div className={`${isCurrentPhase ? "text-primary" : isPastPhase ? "text-green-600" : "text-muted-foreground"}`}>
                      {isPastPhase ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : (
                        <div className={`w-4 h-4 rounded-full border-2 ${isCurrentPhase ? "border-primary bg-primary/20" : "border-muted-foreground/30"}`} />
                      )}
                    </div>
                    <span className={`text-sm ${isCurrentPhase ? "font-medium text-primary" : ""}`}>
                      {config.shortLabel}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Key Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Información</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Radicado Interno</p>
                <p className="font-medium font-mono">{process.radicado}</p>
              </div>
              {process.tipo_actuacion && (
                <div>
                  <p className="text-sm text-muted-foreground">Tipo</p>
                  <Badge variant="outline">{process.tipo_actuacion}</Badge>
                </div>
              )}
              {process.expediente_digital_url && (
                <div>
                  <p className="text-sm text-muted-foreground">Expediente Digital</p>
                  <Button variant="outline" size="sm" className="mt-1" asChild>
                    <a href={process.expediente_digital_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-1" />
                      Abrir
                    </a>
                  </Button>
                </div>
              )}
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground">Creado</p>
                <p className="font-medium">{formatDateColombia(process.created_at)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Última Actualización</p>
                <p className="font-medium">{formatDateColombia(process.updated_at)}</p>
              </div>
              {process.last_checked_at && (
                <div>
                  <p className="text-sm text-muted-foreground">Última Consulta</p>
                  <p className="font-medium">{formatDateColombia(process.last_checked_at)}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
