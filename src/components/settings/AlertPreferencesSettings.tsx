/**
 * AlertPreferencesSettings — User customization of alert types
 * Allows toggling each alert type on/off and configuring email/push preferences.
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Bell, Mail, Save } from "lucide-react";
import { toast } from "sonner";
import { ALERT_TYPE_LABELS, type UserAlertType } from "@/lib/alerts/create-user-alert";

const DEFAULT_PREFERENCES: Record<string, { enabled: boolean; email: boolean; push: boolean; days_before?: number }> = {
  ACTUACION_NUEVA: { enabled: true, email: false, push: true },
  ESTADO_NUEVO: { enabled: true, email: false, push: true },
  STAGE_CHANGE: { enabled: true, email: false, push: true },
  TAREA_CREADA: { enabled: true, email: false, push: false },
  TAREA_VENCIDA: { enabled: true, email: true, push: true },
  AUDIENCIA_PROXIMA: { enabled: true, email: true, push: true, days_before: 3 },
  AUDIENCIA_CREADA: { enabled: true, email: false, push: true },
  TERMINO_CRITICO: { enabled: true, email: true, push: true },
  TERMINO_VENCIDO: { enabled: true, email: true, push: true },
  PETICION_CREADA: { enabled: true, email: false, push: false },
  HITO_ALCANZADO: { enabled: true, email: false, push: true },
};

export function AlertPreferencesSettings() {
  const queryClient = useQueryClient();
  const [prefs, setPrefs] = useState(DEFAULT_PREFERENCES);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: savedPrefs, isLoading } = useQuery({
    queryKey: ["alert-preferences"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await (supabase.from("alert_preferences") as any)
        .select("preferences")
        .eq("user_id", user.id)
        .maybeSingle();
      return data?.preferences ?? null;
    },
  });

  useEffect(() => {
    if (savedPrefs) {
      setPrefs({ ...DEFAULT_PREFERENCES, ...savedPrefs });
    }
  }, [savedPrefs]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      
      const { error } = await (supabase.from("alert_preferences") as any)
        .upsert({
          user_id: user.id,
          preferences: prefs,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-preferences"] });
      setHasChanges(false);
      toast.success("Preferencias de alertas guardadas");
    },
    onError: (err) => {
      toast.error("Error al guardar: " + (err as Error).message);
    },
  });

  const updatePref = (type: string, field: string, value: boolean | number) => {
    setPrefs(prev => ({
      ...prev,
      [type]: { ...prev[type], [field]: value },
    }));
    setHasChanges(true);
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Cargando preferencias...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Preferencias de Alertas
        </CardTitle>
        <CardDescription>
          Configura qué tipos de notificaciones deseas recibir y cómo
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Column headers */}
        <div className="grid grid-cols-[1fr_80px_80px_80px] gap-2 items-center text-xs font-medium text-muted-foreground px-1">
          <span>Tipo de alerta</span>
          <span className="text-center">Activa</span>
          <span className="text-center">In-app</span>
          <span className="text-center flex items-center justify-center gap-1">
            <Mail className="h-3 w-3" /> Email
          </span>
        </div>
        <Separator />

        {Object.entries(ALERT_TYPE_LABELS).map(([key, label]) => {
          const pref = prefs[key] || { enabled: true, email: false, push: true };
          const isAudiencia = key === "AUDIENCIA_PROXIMA";

          return (
            <div key={key} className="space-y-2">
              <div className="grid grid-cols-[1fr_80px_80px_80px] gap-2 items-center">
                <div>
                  <Label className="text-sm font-medium">{label}</Label>
                  {isAudiencia && pref.enabled && (
                    <div className="flex items-center gap-2 mt-1">
                      <Label className="text-xs text-muted-foreground">Días de anticipación:</Label>
                      <Input
                        type="number"
                        min={1}
                        max={30}
                        value={pref.days_before ?? 3}
                        onChange={(e) => updatePref(key, "days_before", parseInt(e.target.value) || 3)}
                        className="w-16 h-7 text-xs"
                      />
                    </div>
                  )}
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={pref.enabled}
                    onCheckedChange={(v) => updatePref(key, "enabled", v)}
                  />
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={pref.push}
                    onCheckedChange={(v) => updatePref(key, "push", v)}
                    disabled={!pref.enabled}
                  />
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={pref.email}
                    onCheckedChange={(v) => updatePref(key, "email", v)}
                    disabled={!pref.enabled}
                  />
                </div>
              </div>
            </div>
          );
        })}

        <Separator />

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Las preferencias de email se almacenan pero el envío por correo requiere configuración adicional en Recordatorios.
          </p>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !hasChanges}
          >
            <Save className="h-4 w-4 mr-2" />
            Guardar preferencias
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
