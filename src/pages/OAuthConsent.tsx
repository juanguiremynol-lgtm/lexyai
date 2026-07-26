import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, FileText, CalendarClock, PencilLine, Mail } from "lucide-react";

/** Human-language description of each OAuth scope. */
const SCOPE_LABELS: Record<string, { label: string; detail: string }> = {
  openid: { label: "Tu identidad en Andromeda", detail: "Saber que eres tú quien autoriza la conexión." },
  email: { label: "Tu correo electrónico", detail: "Mostrar la cuenta conectada en la herramienta." },
  profile: { label: "Tu perfil básico", detail: "Tu nombre y el nombre de tu firma." },
  read: { label: "Consultar tu cartera", detail: "Expedientes, actuaciones, estados, términos, audiencias y clientes." },
  read_write: { label: "Agregar notas y audiencias", detail: "Solo puede crear notas y agendar audiencias. Nunca elimina ni reclasifica." },
};

const CAPABILITIES = [
  { icon: FileText, text: "Leer tus expedientes, actuaciones y estados electrónicos" },
  { icon: CalendarClock, text: "Consultar términos, audiencias y tareas pendientes" },
  { icon: PencilLine, text: "Agregar notas o agendar audiencias (solo con permiso de escritura)" },
];

// Typed wrapper for the beta supabase.auth.oauth namespace (used by the
// Supabase-hosted OAuth 2.1 authorization server for Andromeda MCP).
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};
function oauth(): OAuthApi {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase.auth as any).oauth as OAuthApi;
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Falta el parámetro authorization_id.");
        return;
      }
      let { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        // The session may still be hydrating right after a redirect.
        await new Promise((r) => setTimeout(r, 400));
        sess = (await supabase.auth.getSession()).data;
      }
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      if (active) setAccount(sess.session.user.email ?? null);
      const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) {
        setError(error.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorizationId)
      : await oauth().denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("El servidor de autorización no devolvió una URL de redirección.");
      return;
    }
    window.location.href = target;
  }

  const scopes: string[] = Array.isArray(details?.scopes)
    ? details.scopes
    : typeof details?.scope === "string"
      ? details.scope.split(/\s+/).filter(Boolean)
      : [];
  const clientName = details?.client?.name ?? "Una aplicación";

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#070b1a]">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
            {details ? `Conectar ${clientName} a Andromeda` : "Conectar aplicación a Andromeda"}
          </CardTitle>
          <CardDescription>
            {account ? `Vas a autorizar el acceso con la cuenta ${account}.` : "Autoriza el acceso de esta aplicación a tu cuenta."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && (
            <p className="text-sm text-red-500">No se pudo cargar la solicitud: {error}</p>
          )}
          {!error && !details && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {details && (
            <>
              <p className="text-sm">
                <strong>{clientName}</strong> podrá usar Andromeda como tú. Solo verá los expedientes de tu
                cuenta: nunca los de otro abogado ni los de otra firma.
              </p>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Qué podrá hacer</p>
                <ul className="space-y-2">
                  {CAPABILITIES.map(({ icon: Icon, text }) => (
                    <li key={text} className="flex items-start gap-2 text-sm">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span>{text}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {scopes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Datos que compartes</p>
                  <ul className="space-y-2">
                    {scopes.map((scope) => {
                      const known = SCOPE_LABELS[scope];
                      return (
                        <li key={scope} className="flex items-start gap-2 text-sm">
                          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span>
                            <span className="font-medium">{known?.label ?? `Permiso adicional solicitado: ${scope}`}</span>
                            {known && <span className="block text-xs text-muted-foreground">{known.detail}</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Esto no elimina, reclasifica ni cierra expedientes, y no salta las reglas de acceso de Andromeda.
                Puedes revocar el acceso cuando quieras desde Ajustes → Conexiones.
              </p>
            </>
          )}
        </CardContent>
        {details && (
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
              Cancelar
            </Button>
            <Button disabled={busy} onClick={() => decide(true)}>
              {busy ? "Autorizando…" : "Autorizar"}
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}