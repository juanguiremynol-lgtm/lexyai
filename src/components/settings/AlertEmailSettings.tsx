/**
 * AlertEmailSettings — Settings section for managing per-membership alert email
 * Shows current status, change form, verification status, test button
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Mail, CheckCircle, Clock, AlertTriangle, Send, RefreshCw, X, Loader2 } from "lucide-react";
import { useAlertEmail } from "@/hooks/use-alert-email";
import { useOrganization } from "@/contexts/OrganizationContext";

export function AlertEmailSettings() {
  const { organization } = useOrganization();
  const { status, isLoading, setAlertEmail, resendVerification, cancelPending, sendTestEmail } = useAlertEmail(organization?.id || null);
  const [newEmail, setNewEmail] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  if (isLoading || !status) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAlertEmail.mutate(newEmail.trim(), {
      onSuccess: () => {
        setIsEditing(false);
        setNewEmail("");
      },
    });
  };

  const isVerified = !!status.alert_email && !!status.alert_email_verified_at;
  const hasPending = !!status.pending_alert_email;
  const isPendingExpired = hasPending && status.pending_expires_at && new Date(status.pending_expires_at) < new Date();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email de Alertas
        </CardTitle>
        <CardDescription>
          Configura dónde recibir las alertas y notificaciones de la plataforma para esta organización.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current status */}
        <div className="p-4 border rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Email activo para alertas</p>
              <p className="text-base font-mono">{status.effective_email || "No configurado"}</p>
            </div>
            {isVerified ? (
              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                <CheckCircle className="h-3 w-3 mr-1" />
                Verificado
              </Badge>
            ) : status.is_using_login_email ? (
              <Badge variant="secondary">
                Usando email de inicio de sesión
              </Badge>
            ) : (
              <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Sin verificar
              </Badge>
            )}
          </div>
          
          {status.login_email && status.effective_email !== status.login_email && (
            <p className="text-xs text-muted-foreground">
              Email de inicio de sesión: {status.login_email}
            </p>
          )}
        </div>

        {/* Pending verification banner */}
        {hasPending && !isPendingExpired && (
          <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-2">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  Verificación pendiente
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Se envió un enlace de verificación a <strong>{status.pending_alert_email}</strong>.
                  Revisa tu bandeja de entrada.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => resendVerification.mutate()}
                    disabled={resendVerification.isPending}
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${resendVerification.isPending ? "animate-spin" : ""}`} />
                    Reenviar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => cancelPending.mutate()}
                    disabled={cancelPending.isPending}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Cancelar cambio
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {isPendingExpired && (
          <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-300">
              El enlace de verificación para <strong>{status.pending_alert_email}</strong> expiró.
              Puedes reenviar o iniciar un nuevo cambio.
            </p>
            <div className="flex gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => resendVerification.mutate()}
                disabled={resendVerification.isPending}
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${resendVerification.isPending ? "animate-spin" : ""}`} />
                Reenviar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => cancelPending.mutate()}
              >
                <X className="h-3 w-3 mr-1" />
                Cancelar
              </Button>
            </div>
          </div>
        )}

        <Separator />

        {/* Change email form */}
        {!isEditing ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsEditing(true)}>
              <Mail className="h-4 w-4 mr-2" />
              Cambiar email de alertas
            </Button>
            <Button
              variant="outline"
              onClick={() => sendTestEmail.mutate()}
              disabled={sendTestEmail.isPending || !status.effective_email}
            >
              <Send className={`h-4 w-4 mr-2 ${sendTestEmail.isPending ? "animate-pulse" : ""}`} />
              Enviar prueba
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="alert_email">Nuevo email de alertas</Label>
              <div className="flex gap-2">
                <Input
                  id="alert_email"
                  type="email"
                  placeholder="alertas@miempresa.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="flex-1"
                  required
                />
                <Button type="submit" disabled={setAlertEmail.isPending || !newEmail.trim()}>
                  {setAlertEmail.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Guardar"
                  )}
                </Button>
                <Button type="button" variant="ghost" onClick={() => { setIsEditing(false); setNewEmail(""); }}>
                  Cancelar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Si el email es diferente a tu cuenta, se enviará un enlace de verificación.
              </p>
            </div>
          </form>
        )}

        {/* Info box */}
        <div className="p-3 bg-muted/50 border rounded-lg">
          <p className="text-xs text-muted-foreground">
            <strong>Nota:</strong> Mientras el nuevo email no esté verificado, las alertas se seguirán enviando
            a tu email de inicio de sesión. Cada organización puede tener un email de alertas diferente.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
