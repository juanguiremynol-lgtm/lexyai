/**
 * PlatformAdminAlertEmailSettings — Exclusive Super Admin section
 * to configure primary and secondary alert emails.
 * Default primary: gr@lexetlit.com
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Mail, Save, Shield, Plus, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_PRIMARY_EMAIL = "gr@lexetlit.com";

export function PlatformAdminAlertEmailSettings() {
  const queryClient = useQueryClient();
  const [primaryEmail, setPrimaryEmail] = useState(DEFAULT_PRIMARY_EMAIL);
  const [secondaryEmail, setSecondaryEmail] = useState("");
  const [showSecondary, setShowSecondary] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: config, isLoading } = useQuery({
    queryKey: ["platform-admin-alert-config"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from("platform_admin_alert_config")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (config) {
      setPrimaryEmail(config.primary_alert_email || DEFAULT_PRIMARY_EMAIL);
      setSecondaryEmail(config.secondary_alert_email || "");
      setShowSecondary(!!config.secondary_alert_email);
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const payload = {
        user_id: user.id,
        primary_alert_email: primaryEmail.trim() || DEFAULT_PRIMARY_EMAIL,
        secondary_alert_email: secondaryEmail.trim() || null,
      };

      if (config?.id) {
        const { error } = await supabase
          .from("platform_admin_alert_config")
          .update({
            primary_alert_email: payload.primary_alert_email,
            secondary_alert_email: payload.secondary_alert_email,
          })
          .eq("id", config.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("platform_admin_alert_config")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-admin-alert-config"] });
      setHasChanges(false);
      toast.success("Configuración de email de alertas guardada");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handlePrimaryChange = (value: string) => {
    setPrimaryEmail(value);
    setHasChanges(true);
  };

  const handleSecondaryChange = (value: string) => {
    setSecondaryEmail(value);
    setHasChanges(true);
  };

  const removeSecondary = () => {
    setSecondaryEmail("");
    setShowSecondary(false);
    setHasChanges(true);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Email de Alertas — Super Admin
        </CardTitle>
        <CardDescription>
          Configura los correos donde recibes alertas de plataforma, incidentes operacionales y reportes críticos.
          Este ajuste es exclusivo para administradores de plataforma.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Primary email */}
        <div className="space-y-2">
          <Label htmlFor="sa_primary_email" className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Email principal de alertas
          </Label>
          <div className="flex gap-2">
            <Input
              id="sa_primary_email"
              type="email"
              value={primaryEmail}
              onChange={(e) => handlePrimaryChange(e.target.value)}
              placeholder={DEFAULT_PRIMARY_EMAIL}
              className="flex-1"
            />
            <Badge variant="secondary" className="self-center whitespace-nowrap">
              Principal
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Por defecto: <code className="text-xs bg-muted px-1 rounded">{DEFAULT_PRIMARY_EMAIL}</code>.
            Todas las alertas críticas de plataforma se envían a este correo.
          </p>
        </div>

        <Separator />

        {/* Secondary email */}
        {showSecondary ? (
          <div className="space-y-2">
            <Label htmlFor="sa_secondary_email" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email secundario (copia)
            </Label>
            <div className="flex gap-2">
              <Input
                id="sa_secondary_email"
                type="email"
                value={secondaryEmail}
                onChange={(e) => handleSecondaryChange(e.target.value)}
                placeholder="backup@empresa.com"
                className="flex-1"
              />
              <Button variant="ghost" size="icon" onClick={removeSecondary} title="Eliminar email secundario">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Las alertas también se enviarán a este correo como respaldo.
            </p>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => { setShowSecondary(true); setHasChanges(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Agregar email secundario
          </Button>
        )}

        <Separator />

        {/* Info box */}
        <div className="p-3 bg-muted/50 border rounded-lg space-y-2">
          <p className="text-xs text-muted-foreground">
            <strong>Nota:</strong> Los usuarios regulares, administradores de organización y miembros
            configuran su email de alertas durante la creación de perfil. Solo pueden modificarlo
            solicitando a <strong>Andro IA</strong> que habilite la edición del campo de email en su perfil.
          </p>
          <p className="text-xs text-muted-foreground">
            Como Super Admin, tienes control directo sobre tu configuración de email de alertas sin restricciones.
          </p>
        </div>

        {/* Save */}
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!hasChanges || saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {saveMutation.isPending ? "Guardando..." : "Guardar Configuración"}
        </Button>
      </CardContent>
    </Card>
  );
}
