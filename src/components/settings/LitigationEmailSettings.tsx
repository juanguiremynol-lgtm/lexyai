/**
 * LitigationEmailSettings — Professional litigation email management.
 * Allows lawyers to set their litigation email (used in Poder Especial documents).
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Mail, Save, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export function LitigationEmailSettings() {
  const queryClient = useQueryClient();
  const [litigationEmail, setLitigationEmail] = useState("");
  const [professionalAddress, setProfessionalAddress] = useState("");
  const [useSameEmail, setUseSameEmail] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile-litigation-email"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      const { data, error } = await supabase
        .from("profiles")
        .select("email, litigation_email, professional_address")
        .eq("id", user.id)
        .single();
      if (error) throw error;
      return data as { email: string | null; litigation_email: string | null; professional_address: string | null };
    },
  });

  useEffect(() => {
    if (profile) {
      setLitigationEmail(profile.litigation_email || "");
      setProfessionalAddress(profile.professional_address || "");
      setUseSameEmail(!!profile.litigation_email && profile.litigation_email === profile.email);
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      const emailToSave = useSameEmail ? profile?.email : litigationEmail.trim();
      if (!emailToSave) throw new Error("Debe ingresar un email de litigio");
      // Basic email validation
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailToSave)) {
        throw new Error("El formato del email no es válido");
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          litigation_email: emailToSave,
          professional_address: professionalAddress.trim() || null,
        })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile-litigation-email"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Email profesional de litigio guardado");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleSameEmailChange = (checked: boolean) => {
    setUseSameEmail(checked);
    if (checked && profile?.email) {
      setLitigationEmail(profile.email);
    }
  };

  if (isLoading) return null;

  const isConfigured = !!profile?.litigation_email;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Profesional de Litigio
          {isConfigured ? (
            <Badge variant="outline" className="text-primary border-primary/30">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Configurado
            </Badge>
          ) : (
            <Badge variant="outline" className="text-destructive border-destructive/30">
              <AlertTriangle className="h-3 w-3 mr-1" /> Pendiente
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Este debe ser el email que tiene registrado ante la Rama Judicial y que utiliza para
          recibir notificaciones judiciales. Aparecerá en todos los poderes especiales que genere.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm text-muted-foreground">
            Email de cuenta (login)
          </Label>
          <Input value={profile?.email || ""} disabled className="bg-muted" />
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="same-email"
            checked={useSameEmail}
            onCheckedChange={(c) => handleSameEmailChange(!!c)}
          />
          <Label htmlFor="same-email" className="text-sm cursor-pointer">
            Mi email de litigio es el mismo que mi email de cuenta
          </Label>
        </div>

        {!useSameEmail && (
          <div className="space-y-2">
            <Label>Email profesional de litigio *</Label>
            <Input
              type="email"
              value={litigationEmail}
              onChange={(e) => setLitigationEmail(e.target.value)}
              placeholder="abogado@firma.com"
            />
          </div>
        )}

        <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-muted-foreground">
              <strong>IMPORTANTE:</strong> Este email aparecerá en todos los poderes especiales
              como dirección de notificación judicial electrónica del apoderado, conforme al
              artículo 291 del Código General del Proceso. Asegúrese de que sea el email
              correcto registrado ante la Rama Judicial.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Dirección profesional</Label>
          <Input
            value={professionalAddress}
            onChange={(e) => setProfessionalAddress(e.target.value)}
            placeholder="Calle 50 #45-30, Of. 501, Medellín"
          />
          <p className="text-xs text-muted-foreground">
            Esta dirección aparecerá en los poderes especiales como dirección física del apoderado.
          </p>
        </div>

        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Guardar
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * LitigationEmailBanner — Persistent banner shown when litigation_email is not configured.
 */
export function LitigationEmailBanner({ onConfigure }: { onConfigure?: () => void }) {
  const { data: profile } = useQuery({
    queryKey: ["profile-litigation-email-check"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("litigation_email")
        .eq("id", user.id)
        .single();
      return data as { litigation_email: string | null } | null;
    },
    staleTime: 1000 * 60 * 5,
  });

  const [dismissed, setDismissed] = useState(false);

  if (!profile || profile.litigation_email || dismissed) return null;

  return (
    <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <div className="text-sm">
          <strong>Configure su email profesional de litigio</strong>
          <span className="text-muted-foreground ml-1">
            — Requerido para generar poderes especiales.
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onConfigure && (
          <Button variant="outline" size="sm" onClick={onConfigure}>
            Configurar ahora →
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
          Después ✕
        </Button>
      </div>
    </div>
  );
}
