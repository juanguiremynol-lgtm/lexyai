/**
 * Email Settings / Integration Panel
 * IMAP/SMTP configuration card with connection status.
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Mail, Server, Lock, Eye, EyeOff, Loader2, CheckCircle2, XCircle, WifiOff } from "lucide-react";
import { toast } from "sonner";

type ConnectionStatus = "disconnected" | "connected" | "error";

export function EmailSettingsPanel() {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [config, setConfig] = useState({
    email: "info@andromeda.legal",
    password: "",
    imapHost: "imap.hostinger.com",
    imapPort: "993",
    imapSsl: true,
    smtpHost: "smtp.hostinger.com",
    smtpPort: "465",
    smtpSsl: true,
  });

  const updateConfig = (key: keyof typeof config, value: string | boolean) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleConnect = async () => {
    if (!config.email || !config.password) {
      toast.error("Ingresa email y contraseña");
      return;
    }
    setSaving(true);
    // Mock — in production this calls the edge function
    await new Promise((r) => setTimeout(r, 1500));
    setStatus("connected");
    setSaving(false);
    toast.success("Cuenta de email conectada exitosamente");
  };

  const handleDisconnect = () => {
    setStatus("disconnected");
    setConfig((prev) => ({ ...prev, password: "" }));
    toast.info("Cuenta de email desconectada");
  };

  const statusBadge: Record<ConnectionStatus, React.ReactNode> = {
    connected: (
      <Badge className="bg-green-500/15 text-green-600 border-green-500/30">
        <CheckCircle2 className="h-3 w-3 mr-1" /> Conectado
      </Badge>
    ),
    disconnected: (
      <Badge variant="secondary" className="text-muted-foreground">
        <WifiOff className="h-3 w-3 mr-1" /> Desconectado
      </Badge>
    ),
    error: (
      <Badge variant="destructive">
        <XCircle className="h-3 w-3 mr-1" /> Error
      </Badge>
    ),
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Cuenta de Email</CardTitle>
              <CardDescription>Configura tu cuenta IMAP/SMTP para enviar y recibir emails</CardDescription>
            </div>
          </div>
          {statusBadge[status]}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Email & Password */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="email-address">Dirección de email</Label>
            <Input
              id="email-address"
              value={config.email}
              onChange={(e) => updateConfig("email", e.target.value)}
              placeholder="info@andromeda.legal"
              disabled={status === "connected"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email-password">Contraseña</Label>
            <div className="relative">
              <Input
                id="email-password"
                type={showPassword ? "text" : "password"}
                value={config.password}
                onChange={(e) => updateConfig("password", e.target.value)}
                placeholder="••••••••"
                disabled={status === "connected"}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        <Separator />

        {/* IMAP Settings */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Server className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-medium">Servidor IMAP (Recepción)</h4>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label className="text-xs">Host</Label>
              <Input
                value={config.imapHost}
                onChange={(e) => updateConfig("imapHost", e.target.value)}
                placeholder="imap.hostinger.com"
                disabled={status === "connected"}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Puerto</Label>
              <Input
                value={config.imapPort}
                onChange={(e) => updateConfig("imapPort", e.target.value)}
                placeholder="993"
                disabled={status === "connected"}
              />
            </div>
            <div className="flex items-end gap-2 pb-0.5">
              <div className="flex items-center gap-2">
                <Switch
                  checked={config.imapSsl}
                  onCheckedChange={(v) => updateConfig("imapSsl", v)}
                  disabled={status === "connected"}
                />
                <Label className="text-xs flex items-center gap-1">
                  <Lock className="h-3 w-3" /> SSL/TLS
                </Label>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* SMTP Settings */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Server className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-medium">Servidor SMTP (Envío)</h4>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label className="text-xs">Host</Label>
              <Input
                value={config.smtpHost}
                onChange={(e) => updateConfig("smtpHost", e.target.value)}
                placeholder="smtp.hostinger.com"
                disabled={status === "connected"}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Puerto</Label>
              <Input
                value={config.smtpPort}
                onChange={(e) => updateConfig("smtpPort", e.target.value)}
                placeholder="465"
                disabled={status === "connected"}
              />
            </div>
            <div className="flex items-end gap-2 pb-0.5">
              <div className="flex items-center gap-2">
                <Switch
                  checked={config.smtpSsl}
                  onCheckedChange={(v) => updateConfig("smtpSsl", v)}
                  disabled={status === "connected"}
                />
                <Label className="text-xs flex items-center gap-1">
                  <Lock className="h-3 w-3" /> SSL/TLS
                </Label>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Actions */}
        <div className="flex gap-2">
          {status === "connected" ? (
            <Button variant="outline" onClick={handleDisconnect}>
              Desconectar
            </Button>
          ) : (
            <Button onClick={handleConnect} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Mail className="h-4 w-4 mr-2" />}
              Conectar cuenta
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
