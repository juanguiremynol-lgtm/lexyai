/**
 * PlatformEmailConsoleTab — Main console assembling Inbox, Sent, Compose, Debug, and Settings.
 * Includes active provider status banner with quick-switch link.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Inbox, SendHorizonal, PenSquare, Settings2, CheckCircle, AlertTriangle, Loader2, Shield, Wrench } from "lucide-react";
import { InboxView } from "./InboxView";
import { SentView } from "./SentView";
import { ComposeDialog } from "./ComposeDialog";
import { EmailProviderDebugPanel } from "./EmailProviderDebugPanel";
import { SystemEmailSettingsPanel } from "./SystemEmailSettingsPanel";

const PROVIDER_LABELS: Record<string, string> = {
  resend: "Resend",
  sendgrid: "SendGrid",
  aws_ses: "Amazon SES",
  mailgun: "Mailgun",
  smtp: "SMTP Custom",
};

async function fetchProviderStatus() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-provider-admin`,
    { method: "GET", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" } }
  );
  const data = await res.json();
  return res.ok && data.ok ? data : null;
}

export function PlatformEmailConsoleTab() {
  const [composeOpen, setComposeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("inbox");
  const navigate = useNavigate();

  const { data: providerStatus, isLoading: providerLoading } = useQuery({
    queryKey: ["email-provider-status-banner"],
    queryFn: fetchProviderStatus,
    staleTime: 30_000,
  });

  const activeProvider = providerStatus?.active_provider;
  const isConfigured = providerStatus?.is_configured;
  const env = providerStatus?.environment;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email Console</h1>
          <p className="text-muted-foreground text-sm">
            Bandeja unificada de emails entrantes y enviados — uso exclusivo de plataforma.
          </p>
        </div>
        <Button onClick={() => setComposeOpen(true)}>
          <PenSquare className="h-4 w-4 mr-2" /> Componer
        </Button>
      </div>

      {/* Active Provider Status Banner */}
      <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          {providerLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : isConfigured && activeProvider ? (
            <>
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium">
                Proveedor activo: <span className="text-foreground">{PROVIDER_LABELS[activeProvider] || activeProvider}</span>
              </span>
              <Badge variant="outline" className="text-xs">
                {env === "production" ? "🚀 Producción" : "🧪 Sandbox"}
              </Badge>
            </>
          ) : (
            <>
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <span className="text-sm text-muted-foreground">
                {activeProvider
                  ? `${PROVIDER_LABELS[activeProvider] || activeProvider} seleccionado pero no activado`
                  : "Sin proveedor de email configurado"}
              </span>
            </>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/platform/email-provider")}
          className="gap-1.5"
        >
          <Settings2 className="h-3.5 w-3.5" />
          {activeProvider ? "Cambiar Proveedor" : "Configurar Proveedor"}
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="inbox" className="gap-1.5">
            <Inbox className="h-4 w-4" /> Bandeja
          </TabsTrigger>
          <TabsTrigger value="sent" className="gap-1.5">
            <SendHorizonal className="h-4 w-4" /> Enviados
          </TabsTrigger>
          <TabsTrigger value="debug" className="gap-1.5">
            <Shield className="h-4 w-4" /> Debug
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5">
            <Wrench className="h-4 w-4" /> Configuración
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox">
          <InboxView />
        </TabsContent>
        <TabsContent value="sent">
          <SentView />
        </TabsContent>
        <TabsContent value="debug">
          <EmailProviderDebugPanel />
        </TabsContent>
        <TabsContent value="settings">
          <SystemEmailSettingsPanel />
        </TabsContent>
      </Tabs>

      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        onSent={() => setActiveTab("sent")}
      />
    </div>
  );
}
