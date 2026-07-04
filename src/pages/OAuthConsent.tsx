import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Falta el parámetro authorization_id.");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
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

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#070b1a]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Conectar aplicación a Andromeda</CardTitle>
          <CardDescription>
            Autoriza el acceso de esta aplicación a tu cuenta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="text-sm text-red-500">No se pudo cargar la solicitud: {error}</p>
          )}
          {!error && !details && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {details && (
            <>
              <p className="text-sm">
                <strong>{details.client?.name ?? "Una aplicación"}</strong> quiere acceder a Andromeda
                usando tu cuenta. Podrá consultar tus asuntos y novedades judiciales dentro de los
                permisos de tu usuario (RLS).
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
                  Denegar
                </Button>
                <Button disabled={busy} onClick={() => decide(true)}>
                  Aprobar
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}