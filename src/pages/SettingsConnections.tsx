/**
 * SettingsConnections — /app/settings/connections
 *
 * Lists the OAuth grants the signed-in user has approved (Supabase Auth OAuth
 * 2.1 server) and lets them revoke any of them.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, Check, Plug, ShieldOff, RefreshCw, Mail, ShieldCheck, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { useEmailConnection } from "@/hooks/use-email-connection";

const MCP_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/mcp`;

const SCOPE_LABELS: Record<string, string> = {
  openid: "Identidad",
  email: "Correo",
  profile: "Perfil",
  read: "Lectura de la cartera",
  read_write: "Notas y audiencias",
};

type Grant = {
  client?: { client_id?: string; id?: string; name?: string; client_name?: string } | null;
  scopes?: string[];
  granted_at?: string;
  last_used_at?: string;
};

function oauthApi() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase.auth as any).oauth as {
    listGrants: () => Promise<{ data: Grant[] | null; error: { message: string } | null }>;
    revokeGrant: (o: { clientId: string }) => Promise<{ error: { message: string } | null }>;
  } | undefined;
}

function fmt(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
}

/** Outlook mailbox: read-only metadata linking, per subscriber. */
function OutlookConnectionCard() {
  const { connection, isLoading, connect, disconnect, sync } = useEmailConnection();
  const connected = connection?.status === "CONNECTED";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-primary" aria-hidden />
            Correo electrónico
          </CardTitle>
          <CardDescription>
            Conecta tu buzón de Outlook para que Andromeda vincule los correos a tus expedientes.
          </CardDescription>
        </div>
        {connected && (
          <Badge variant="secondary" className="shrink-0">Conectado</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p>
            Andromeda solo lee metadatos y vincula correos a tus expedientes. Nunca envía correos ni
            almacena su contenido completo.
          </p>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando conexión…</p>
        ) : connected ? (
          <div className="space-y-3">
            <div className="space-y-1 text-sm">
              <p className="font-medium">{connection?.ms_account_email ?? "Cuenta de Outlook"}</p>
              <p className="text-xs text-muted-foreground">Conectada el {fmt(connection?.connected_at)}</p>
              <p className="text-xs text-muted-foreground">
                Última sincronización: {fmt(connection?.last_sync_at)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
                <RotateCw className="mr-2 h-4 w-4" aria-hidden />
                {sync.isPending ? "Sincronizando…" : "Sincronizar ahora"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
              >
                <ShieldOff className="mr-2 h-4 w-4" aria-hidden />
                {disconnect.isPending ? "Desconectando…" : "Desconectar"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {connection?.status === "ERROR" && connection.last_error && (
              <p className="text-sm text-destructive">
                La última sincronización falló: {connection.last_error}
              </p>
            )}
            <Button size="sm" onClick={() => connect.mutate()} disabled={connect.isPending}>
              <Mail className="mr-2 h-4 w-4" aria-hidden />
              {connect.isPending ? "Abriendo Microsoft…" : "Conectar Outlook"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsConnections() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const api = oauthApi();
      if (!api?.listGrants) {
        setGrants([]);
        setError("Tu sesión no expone el listado de conexiones. Vuelve a iniciar sesión.");
        return;
      }
      const { data, error } = await api.listGrants();
      if (error) {
        setGrants([]);
        setError(error.message);
        return;
      }
      setGrants(Array.isArray(data) ? data : []);
    } catch (e) {
      setGrants([]);
      setError(e instanceof Error ? e.message : "No se pudieron cargar las conexiones.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (clientId: string, name: string) => {
    setRevoking(clientId);
    const previous = grants;
    try {
      const { error } = await (oauthApi()!.revokeGrant({ clientId }));
      if (error) throw new Error(error.message);
      toast.success(`Acceso revocado a ${name}`);
      await load();
    } catch (e) {
      setGrants(previous);
      toast.error(e instanceof Error ? e.message : "No se pudo revocar el acceso.");
    } finally {
      setRevoking(null);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(MCP_URL);
    setCopied(true);
    toast.success("Dirección del servidor copiada");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="container max-w-3xl space-y-6 py-8">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Plug className="h-6 w-6 text-primary" aria-hidden />
          Conexiones
        </h1>
        <p className="text-muted-foreground">
          Tu buzón de correo y las herramientas de IA autorizadas para acceder a tu cartera.
        </p>
      </header>

      <OutlookConnectionCard />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Nueva conexión</CardTitle>
            <CardDescription>Copia la dirección y pégala en tu asistente (Claude, ChatGPT, Cursor…).</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
            Copiar URL
          </Button>
        </CardHeader>
        <CardContent>
          <code className="block break-all rounded-md bg-muted px-3 py-2 text-sm">{MCP_URL}</code>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Herramientas conectadas</CardTitle>
            <CardDescription>Revoca el acceso en cualquier momento.</CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void load()} aria-label="Actualizar lista">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && <p className="text-sm text-muted-foreground">Cargando conexiones…</p>}
          {!loading && error && <p className="text-sm text-destructive">{error}</p>}
          {!loading && !error && grants.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Todavía no has autorizado ninguna herramienta. Usa la dirección de arriba para conectar la primera.
            </p>
          )}
          {grants.map((grant) => {
            const clientId = grant.client?.client_id ?? grant.client?.id ?? "";
            const name = grant.client?.name ?? grant.client?.client_name ?? "Aplicación sin nombre";
            return (
              <div key={clientId || name} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4">
                <div className="space-y-1">
                  <p className="font-medium">{name}</p>
                  <p className="text-xs text-muted-foreground">Conectada el {fmt(grant.granted_at)}</p>
                  <p className="text-xs text-muted-foreground">Último uso: {fmt(grant.last_used_at)}</p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {(grant.scopes ?? []).map((s) => (
                      <Badge key={s} variant="secondary">{SCOPE_LABELS[s] ?? s}</Badge>
                    ))}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!clientId || revoking === clientId}
                  onClick={() => void revoke(clientId, name)}
                >
                  <ShieldOff className="mr-2 h-4 w-4" />
                  {revoking === clientId ? "Revocando…" : "Revocar acceso"}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}