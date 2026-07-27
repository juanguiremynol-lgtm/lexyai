/**
 * EmailPage — Consolidated mail evidence console.
 *
 * This page is NOT an inbox: Andromeda never mirrors the user's mailbox.
 * Its only jobs are (a) Outlook connection state, (b) outbound composition
 * behind the mandatory confirmation modal, and (c) portfolio-wide queues of
 * suggested links / detected processes that feed each work item.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, PenSquare, RefreshCw, ShieldCheck, Settings2, Loader2 } from "lucide-react";
import { DetectedProcessesQueue } from "@/components/email/DetectedProcessesQueue";
import { SuggestedEmailLinksQueue } from "@/components/email/SuggestedEmailLinksQueue";
import { OutlookComposeDialog } from "@/components/email/OutlookComposeDialog";
import { useEmailConnection } from "@/hooks/use-email-connection";

export default function EmailPage() {
  const { connection, isConnected, canSend, sync } = useEmailConnection();
  const [composeOpen, setComposeOpen] = useState(false);

  return (
    <div className="container mx-auto space-y-6 px-4 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Mail className="h-6 w-6 text-primary" aria-hidden />
          Correo
        </h1>
        <p className="text-sm text-muted-foreground">
          Andromeda no replica tu buzón: solo infiere qué correos pertenecen a cada expediente y
          conserva metadatos y evidencia. Los correos vinculados se consultan dentro de cada expediente.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Conexión de correo
            <Badge variant={isConnected ? "default" : "secondary"}>
              {isConnected ? "Conectado" : connection ? connection.status : "Sin conectar"}
            </Badge>
          </CardTitle>
          <CardDescription>
            {connection?.ms_account_email
              ? `Buzón ${connection.ms_account_email}`
              : "Conecta tu buzón de Outlook desde Configuración › Conexiones."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/app/settings/connections">
              <Settings2 className="mr-1.5 h-4 w-4" aria-hidden />
              Gestionar conexión
            </Link>
          </Button>
          <Button
            variant="outline"
            disabled={!isConnected || sync.isPending}
            onClick={() => sync.mutate()}
          >
            {sync.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />
            )}
            Revisar buzón ahora
          </Button>
          <Button disabled={!canSend} onClick={() => setComposeOpen(true)}>
            <PenSquare className="mr-1.5 h-4 w-4" aria-hidden />
            Redactar correo
          </Button>
        </CardContent>
      </Card>

      <SuggestedEmailLinksQueue />
      <DetectedProcessesQueue />

      <OutlookComposeDialog open={composeOpen} onOpenChange={setComposeOpen} />
    </div>
  );
}
