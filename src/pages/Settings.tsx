import { useState, useMemo } from "react";
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
import { Save, Download, Clock, FileText, Mail, Bell, Upload, CalendarOff, AlertTriangle, Crown, Users, Activity, Shield, CreditCard, Server, Bot, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { EstadosImport } from "@/components/estados";
import { IcarusExcelImport, IcarusImportHistory } from "@/components/icarus-import";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";
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
import { ProviderInstanceManager } from "@/components/settings/ProviderInstanceManager";
import { UserPrivacySettings } from "@/components/settings/UserPrivacySettings";
import { useOrganizationMembership } from "@/hooks/use-organization-membership";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useMascotPreferences } from "@/components/atenia-mascot/useMascotPreferences";
import { Select as RadixSelect, SelectContent, SelectItem as RadixSelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Settings() {
  const queryClient = useQueryClient();
  const { organization, isLoading: isOrgLoading } = useOrganization();
  const { isOwner, isAdmin, isLoading: isMembershipLoading } = useOrganizationMembership(organization?.id || null);
  const { isPlatformAdmin } = usePlatformAdmin();
  const { prefs: mascotPrefs, updatePrefs: updateMascotPrefs } = useMascotPreferences();
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

  // Check if danger zone is unlocked (active token from Atenia AI)
  const { data: dangerZoneUnlocked } = useQuery({
    queryKey: ["danger-zone-unlock"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data, error } = await supabase
        .from("danger_zone_unlocks")
        .select("id, expires_at")
        .eq("user_id", user.id)
        .gte("expires_at", new Date().toISOString())
        .order("expires_at", { ascending: false })
        .limit(1);
      if (error) return false;
      return data && data.length > 0;
    },
    refetchInterval: 30_000, // Re-check every 30s for expiration
  });

  const isDangerZoneVisible = !!dangerZoneUnlocked;

  const dangerZoneExpiry = useQuery({
    queryKey: ["danger-zone-unlock-expiry"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("danger_zone_unlocks")
        .select("expires_at")
        .eq("user_id", user.id)
        .gte("expires_at", new Date().toISOString())
        .order("expires_at", { ascending: false })
        .limit(1);
      return data?.[0]?.expires_at || null;
    },
    enabled: isDangerZoneVisible,
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

      <Tabs defaultValue={isAdmin ? "admin" : "subscription"} className="space-y-6">
        <TabsList className="flex-wrap h-auto gap-1">
          {isAdmin && (
            <>
              <TabsTrigger value="admin" className="bg-primary/5 hover:bg-primary/10">
                <Shield className="h-4 w-4 mr-1" />
                Administración de Cuenta
              </TabsTrigger>
            </>
          )}
          {/* Subscription & Billing: visible to all, write actions gated inside */}
          <TabsTrigger value="subscription">
            <Crown className="h-4 w-4 mr-1" />
            Suscripción
          </TabsTrigger>
          <TabsTrigger value="billing">
            <CreditCard className="h-4 w-4 mr-1" />
            Facturación
          </TabsTrigger>
          {isAdmin && (
            <>
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
              <TabsTrigger value="providers">
                <Server className="h-4 w-4 mr-1" />
                Proveedores
              </TabsTrigger>
            </>
          )}
          <TabsTrigger value="ticker">Ticker</TabsTrigger>
          <TabsTrigger value="recordatorios">Recordatorios</TabsTrigger>
          <TabsTrigger value="suspensiones">Suspensiones</TabsTrigger>
          <TabsTrigger value="sla">SLAs</TabsTrigger>
          <TabsTrigger value="estados">Estados</TabsTrigger>
          {isPlatformAdmin && (
            <TabsTrigger value="integrations">Integraciones ICARUS</TabsTrigger>
          )}
          {isPlatformAdmin && (
            <TabsTrigger value="export">Exportar ICARUS</TabsTrigger>
          )}
          <TabsTrigger value="privacy">
            <ShieldCheck className="h-4 w-4 mr-1" />
            Privacidad
          </TabsTrigger>
          <TabsTrigger value="atenia">
            <Bot className="h-4 w-4 mr-1" />
            Atenia AI
          </TabsTrigger>
          {isDangerZoneVisible && (
            <TabsTrigger value="danger" className="text-destructive data-[state=active]:text-destructive">
              <AlertTriangle className="h-4 w-4 mr-1" />
              Peligro
            </TabsTrigger>
          )}
        </TabsList>

        {isAdmin && (
          <TabsContent value="admin">
            <AdminConsole />
          </TabsContent>
        )}

        {/* Subscription: read-only for all users */}
        <TabsContent value="subscription">
          <SubscriptionManagement />
        </TabsContent>

        {/* Billing: visible to all, write actions gated inside the component */}
        <TabsContent value="billing">
          <BillingTab />
        </TabsContent>

        {isAdmin && (
          <>
            <TabsContent value="members">
              <MembershipManagement />
            </TabsContent>

            <TabsContent value="invites">
              <InvitesManagement />
            </TabsContent>

            <TabsContent value="health">
              <SystemHealthDashboard />
            </TabsContent>

            <TabsContent value="providers">
              <ProviderInstanceManager />
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

        {isPlatformAdmin && (
          <TabsContent value="integrations">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Upload className="h-5 w-5" />
                    Importar Procesos (Excel) — Solo Super Admin
                  </CardTitle>
                  <CardDescription>
                    Importa procesos desde un archivo Excel exportado de ICARUS (fallback)
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
        )}

        {isPlatformAdmin && (
          <TabsContent value="export">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Exportar para ICARUS — Solo Super Admin
                </CardTitle>
                <CardDescription>
                  Descarga los radicados confirmados en formato CSV (fallback)
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
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="privacy">
          <UserPrivacySettings />
        </TabsContent>

        <TabsContent value="atenia" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                Asistente Atenia AI
              </CardTitle>
              <CardDescription>
                Configura la visibilidad y comportamiento del asistente Atenia AI
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <p className="font-medium">Mostrar asistente</p>
                  <p className="text-sm text-muted-foreground">
                    Muestra el robot de Atenia AI en la esquina de la pantalla.
                  </p>
                </div>
                <Switch
                  checked={mascotPrefs.visible}
                  onCheckedChange={(v) => updateMascotPrefs({ visible: v })}
                />
              </div>

              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <p className="font-medium">Mostrar consejos</p>
                  <p className="text-sm text-muted-foreground">
                    Atenia muestra sugerencias contextuales periódicamente.
                  </p>
                </div>
                <Switch
                  checked={mascotPrefs.tips_enabled}
                  onCheckedChange={(v) => updateMascotPrefs({ tips_enabled: v })}
                  disabled={!mascotPrefs.visible}
                />
              </div>

              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <p className="font-medium">Posición</p>
                  <p className="text-sm text-muted-foreground">
                    Elige dónde aparece el asistente en la pantalla.
                  </p>
                </div>
                <RadixSelect
                  value={mascotPrefs.position}
                  onValueChange={(v) => updateMascotPrefs({ position: v as "bottom-right" | "bottom-left" | "top-right" })}
                  disabled={!mascotPrefs.visible}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <RadixSelectItem value="bottom-right">Abajo derecha</RadixSelectItem>
                    <RadixSelectItem value="bottom-left">Abajo izquierda</RadixSelectItem>
                    <RadixSelectItem value="top-right">Arriba derecha</RadixSelectItem>
                  </SelectContent>
                </RadixSelect>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {isDangerZoneVisible && (
          <TabsContent value="danger" className="space-y-6">
            <Card className="border-amber-500/50 bg-amber-500/5">
              <CardContent className="py-4">
                <div className="flex items-center gap-3 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium">Zona de Peligro activa temporalmente</p>
                    <p className="text-muted-foreground">
                      Habilitada por Atenia AI. 
                      {dangerZoneExpiry.data && (
                        <> Expira: {new Date(dangerZoneExpiry.data).toLocaleString("es-CO")}</>
                      )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <ArchivedItemsSection />
            <PurgeLegacyDataSection />
            <MasterDeleteSection />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
