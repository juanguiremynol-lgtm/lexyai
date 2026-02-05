import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Save, Download, Clock, FileText, Mail, Bell, Upload, CalendarOff, AlertTriangle, Crown, Users, Activity, Shield, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { EstadosImport } from "@/components/estados";
import { IcarusExcelImport, IcarusImportHistory } from "@/components/icarus-import";
import { HearingReminderSettings } from "@/components/settings/HearingReminderSettings";
import { JudicialSuspensionsSettings } from "@/components/settings/JudicialSuspensionsSettings";
import { MasterDeleteSection } from "@/components/settings/MasterDeleteSection";
import { PurgeLegacyDataSection } from "@/components/settings/PurgeLegacyDataSection";
import { ArchivedItemsSection } from "@/components/settings/ArchivedItemsSection";
import { TickerSettings } from "@/components/settings/TickerSettings";
import { StalenessAlertSettings } from "@/components/settings/StalenessAlertSettings";
import { SubscriptionManagement } from "@/components/settings/SubscriptionManagement";
import { MembershipManagement } from "@/components/settings/MembershipManagement";
import { InvitesManagement } from "@/components/settings/InvitesManagement";
import { SystemHealthDashboard } from "@/components/settings/SystemHealthDashboard";
import { AdminConsole } from "@/components/admin";
import { BillingTab } from "@/components/settings/BillingTab";
import { useOrganizationMembership } from "@/hooks/use-organization-membership";
import { useOrganization } from "@/contexts/OrganizationContext";

export default function Settings() {
  const queryClient = useQueryClient();
  const { organization, isLoading: isOrgLoading } = useOrganization();
  const { isOwner, isAdmin, isLoading: isMembershipLoading } = useOrganizationMembership(organization?.id || null);
  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const updateProfile = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Configuración guardada");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });


  const handleSlaSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    updateProfile.mutate({
      sla_receipt_hours: parseInt(form.get("sla_receipt_hours") as string) || 24,
      sla_acta_days: parseInt(form.get("sla_acta_days") as string) || 5,
      sla_court_reply_days: parseInt(form.get("sla_court_reply_days") as string) || 3,
    });
  };
  const exportIcarus = async () => {
    const { data, error } = await supabase
      .from("work_items")
      .select("id, radicado, authority_name, workflow_type, updated_at, title")
      .in("status", ["ACTIVE"])
      .not("radicado", "is", null);

    if (error) {
      toast.error("Error al exportar: " + error.message);
      return;
    }

    if (!data || data.length === 0) {
      toast.info("No hay radicados para exportar");
      return;
    }

    const csvContent = [
      ["Radicado", "Juzgado", "Tipo", "Titulo", "Fecha Actualización"].join(","),
      ...data.map((f) => {
        return [
          f.radicado,
          `"${f.authority_name || ""}"`,
          f.workflow_type,
          `"${f.title || ""}"`,
          new Date(f.updated_at).toLocaleDateString("es-CO"),
        ].join(",");
      }),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `icarus_export_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    toast.success("Archivo CSV descargado");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold">Configuración</h1>
        <p className="text-muted-foreground">
          Gestiona tu perfil y preferencias
        </p>
      </div>

      <Tabs defaultValue={isAdmin ? "admin" : "ticker"} className="space-y-6">
        <TabsList className="flex-wrap h-auto gap-1">
          {isAdmin && (
            <>
              <TabsTrigger value="admin" className="bg-primary/5 hover:bg-primary/10">
                <Shield className="h-4 w-4 mr-1" />
                Administración de Cuenta
              </TabsTrigger>
              <TabsTrigger value="subscription">
                <Crown className="h-4 w-4 mr-1" />
                Suscripción
              </TabsTrigger>
              <TabsTrigger value="billing">
                <CreditCard className="h-4 w-4 mr-1" />
                Facturación
              </TabsTrigger>
              <TabsTrigger value="members">
                <Users className="h-4 w-4 mr-1" />
                Miembros
              </TabsTrigger>
              <TabsTrigger value="invites">
                <Mail className="h-4 w-4 mr-1" />
                Invitaciones
              </TabsTrigger>
              <TabsTrigger value="health">
                <Activity className="h-4 w-4 mr-1" />
                Sistema
              </TabsTrigger>
            </>
          )}
          <TabsTrigger value="ticker">Ticker</TabsTrigger>
          <TabsTrigger value="recordatorios">Recordatorios</TabsTrigger>
          <TabsTrigger value="suspensiones">Suspensiones</TabsTrigger>
          <TabsTrigger value="sla">SLAs</TabsTrigger>
          <TabsTrigger value="estados">Estados</TabsTrigger>
          <TabsTrigger value="integrations">Integraciones</TabsTrigger>
          <TabsTrigger value="export">Exportar</TabsTrigger>
          <TabsTrigger value="danger" className="text-destructive data-[state=active]:text-destructive">
            <AlertTriangle className="h-4 w-4 mr-1" />
            Peligro
          </TabsTrigger>
        </TabsList>

        {isAdmin && (
          <>
            <TabsContent value="admin">
              <AdminConsole />
            </TabsContent>

            <TabsContent value="subscription">
              <SubscriptionManagement />
            </TabsContent>

            <TabsContent value="billing">
              <BillingTab />
            </TabsContent>

            <TabsContent value="members">
              <MembershipManagement />
            </TabsContent>

            <TabsContent value="invites">
              <InvitesManagement />
            </TabsContent>

            <TabsContent value="health">
              <SystemHealthDashboard />
            </TabsContent>
          </>
        )}

        <TabsContent value="ticker">
          <TickerSettings />
        </TabsContent>

        <TabsContent value="recordatorios" className="space-y-6">
          <StalenessAlertSettings />
          <HearingReminderSettings profile={profile as Record<string, unknown> | null} />
          
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Recordatorios por Correo
              </CardTitle>
              <CardDescription>
                Configure las alertas y recordatorios automáticos por correo electrónico
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <p className="font-medium">Recordatorios por correo</p>
                  <p className="text-sm text-muted-foreground">
                    Reciba alertas automáticas sobre vencimientos de SLA, plazos judiciales y peticiones
                  </p>
                </div>
                <Switch
                  checked={profile?.email_reminders_enabled ?? true}
                  onCheckedChange={(checked) => {
                    updateProfile.mutate({ email_reminders_enabled: checked });
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="reminder_email">Correo para recordatorios</Label>
                <div className="flex gap-2">
                  <Input
                    id="reminder_email"
                    type="email"
                    placeholder="su-correo@ejemplo.com"
                    defaultValue={profile?.reminder_email || ""}
                    className="flex-1"
                  />
                  <Button
                    onClick={() => {
                      const input = document.getElementById("reminder_email") as HTMLInputElement;
                      if (input?.value) {
                        updateProfile.mutate({ reminder_email: input.value });
                      }
                    }}
                    disabled={updateProfile.isPending}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Guardar
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h4 className="font-medium">Tipos de recordatorios</h4>
                <div className="grid gap-3">
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-red-100 text-red-600">
                        <Clock className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">Vencimiento de SLA</p>
                        <p className="text-xs text-muted-foreground">Según intervalos configurados</p>
                      </div>
                    </div>
                    <Badge variant="default">Activo</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-purple-100 text-purple-600">
                        <Clock className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">Audiencias</p>
                        <p className="text-xs text-muted-foreground">Según intervalos configurados arriba</p>
                      </div>
                    </div>
                    <Badge variant="default">Activo</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-blue-100 text-blue-600">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">Peticiones</p>
                        <p className="text-xs text-muted-foreground">7, 5, 3, 1 días y al vencer</p>
                      </div>
                    </div>
                    <Badge variant="default">Activo</Badge>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
                <h4 className="font-medium text-sm mb-2">Probar recordatorios</h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Envíe un correo de prueba para verificar la configuración
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const email = profile?.reminder_email;
                    if (!email) {
                      toast.error("Configure un correo para recordatorios primero");
                      return;
                    }
                    try {
                      const { error } = await supabase.functions.invoke("send-reminder", {
                        body: {
                          type: "test",
                          recipientEmail: email,
                          recipientName: profile?.full_name,
                          subject: "Correo de prueba",
                          message: "Este es un correo de prueba para verificar que los recordatorios funcionan correctamente.",
                        },
                      });
                      if (error) throw error;
                      toast.success("Correo de prueba enviado");
                    } catch (err) {
                      toast.error("Error al enviar: " + (err as Error).message);
                    }
                  }}
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Enviar correo de prueba
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suspensiones">
          <JudicialSuspensionsSettings />
        </TabsContent>

        <TabsContent value="sla">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Configuración de SLAs
              </CardTitle>
              <CardDescription>
                Define los tiempos límite para cada etapa del proceso
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSlaSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="sla_receipt_hours">
                      Recibo de Reparto (horas)
                    </Label>
                    <Input
                      id="sla_receipt_hours"
                      name="sla_receipt_hours"
                      type="number"
                      min="1"
                      defaultValue={profile?.sla_receipt_hours || 24}
                    />
                    <p className="text-xs text-muted-foreground">
                      Tiempo para confirmar recibo del correo a reparto
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sla_acta_days">
                      Acta de Reparto (días)
                    </Label>
                    <Input
                      id="sla_acta_days"
                      name="sla_acta_days"
                      type="number"
                      min="1"
                      defaultValue={profile?.sla_acta_days || 5}
                    />
                    <p className="text-xs text-muted-foreground">
                      Tiempo para recibir el acta de reparto
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sla_court_reply_days">
                      Respuesta del Juzgado (días)
                    </Label>
                    <Input
                      id="sla_court_reply_days"
                      name="sla_court_reply_days"
                      type="number"
                      min="1"
                      defaultValue={profile?.sla_court_reply_days || 3}
                    />
                    <p className="text-xs text-muted-foreground">
                      Tiempo para respuesta del juzgado asignado
                    </p>
                  </div>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    <strong>Nota:</strong> Los SLAs se calculan en días calendario. 
                    Una futura versión incluirá el calendario de días hábiles de Colombia.
                  </p>
                </div>
                <Button type="submit" disabled={updateProfile.isPending}>
                  <Save className="h-4 w-4 mr-2" />
                  Guardar SLAs
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="estados">
          <EstadosImport />
        </TabsContent>

        <TabsContent value="integrations">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Importar Procesos (Excel)
                </CardTitle>
                <CardDescription>
                  Importa procesos desde un archivo Excel exportado de tu sistema de gestión
                </CardDescription>
              </CardHeader>
              <CardContent>
                <IcarusExcelImport />
                <Separator className="my-6" />
                <IcarusImportHistory />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="export">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Exportar para Icarus
              </CardTitle>
              <CardDescription>
                Descarga los radicados confirmados en formato CSV
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Este archivo incluye todas las radicaciones con estado{" "}
                <Badge variant="outline">RADICADO_CONFIRMED</Badge> o{" "}
                <Badge variant="outline">ICARUS_SYNC_PENDING</Badge> que tengan
                un número de radicado asignado.
              </p>
              <Button onClick={exportIcarus}>
                <Download className="h-4 w-4 mr-2" />
                Descargar CSV
              </Button>

              <Separator className="my-6" />

              <div className="space-y-4">
                <h3 className="font-medium">Roadmap v2</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">📧 Integración Gmail/Outlook</h4>
                    <p className="text-sm text-muted-foreground">
                      Recepción automática de correos y clasificación de actas
                    </p>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">📄 OCR de Actas</h4>
                    <p className="text-sm text-muted-foreground">
                      Extracción automática de radicado y juzgado del PDF
                    </p>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">📅 Calendario Colombiano</h4>
                    <p className="text-sm text-muted-foreground">
                      SLAs calculados en días hábiles con festivos
                    </p>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">🏛️ Directorio de Juzgados</h4>
                    <p className="text-sm text-muted-foreground">
                      Base de datos de juzgados por circuito con correos
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="danger" className="space-y-6">
          <ArchivedItemsSection />
          <PurgeLegacyDataSection />
          <MasterDeleteSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
