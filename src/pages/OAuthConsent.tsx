import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ShieldCheck } from "lucide-react";
import { AI_CONNECTIONS_PATH, MANAGEMENT_SCOPE, MANAGEMENT_BOUNDARY, authorizationIdentity, managementScopeAllowed, saveConnectionPermission, followAuthorizationCallback, type AuthorizationIdentity, type ConnectionPermission } from "@/lib/mcp-consent";

type OAuthResult = { data: { redirect_url?: string } | null; error: { message: string } | null };
type OAuthApi = {
  getAuthorizationDetails(id: string): Promise<{ data: { redirect_url?: string; client?: { id?: string; client_id?: string }; user?: { id?: string } } | null; error: { message: string } | null }>;
  approveAuthorization(id: string, options: { skipBrowserRedirect: boolean }): Promise<OAuthResult>;
  denyAuthorization(id: string, options: { skipBrowserRedirect: boolean }): Promise<OAuthResult>;
};
const oauth = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [identity, setIdentity] = useState<AuthorizationIdentity | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [permission, setPermission] = useState<ConnectionPermission>("read");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [reload, setReload] = useState(0);
  const epoch = useRef(0);
  const locked = useRef(false);
  const owner = useRef<string | null>(null);
  const callback = useRef<string | null>(null);

  useEffect(() => {
    const generation = ++epoch.current;
    let active = true;
    locked.current = false;
    callback.current = null;
    owner.current = null;
    setIdentity(null); setAccount(null); setPermission("read"); setError(null); setBusy(false); setApproved(false);
    const valid = () => active && epoch.current === generation;
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (owner.current && session?.user.id !== owner.current) {
        epoch.current++;
        callback.current = null;
        setReload(value => value + 1);
      }
    });
    void (async () => {
      try {
        if (!authorizationId) throw new Error("La solicitud está incompleta. Vuelve a conectar desde tu asistente.");
        const { data, error: userError } = await supabase.auth.getUser();
        if (!valid()) return;
        if (userError || !data.user) {
          const next = window.location.pathname + window.location.search + window.location.hash;
          window.location.assign("/auth?next=" + encodeURIComponent(next));
          return;
        }
        owner.current = data.user.id;
        setAccount(data.user.email ?? "Cuenta verificada");
        const result = await oauth().getAuthorizationDetails(authorizationId);
        if (!valid()) return;
        if (result.error || !result.data) throw new Error("No se pudo cargar la solicitud. Puede haber vencido; vuelve a conectar desde tu asistente.");
        const trusted = await authorizationIdentity(authorizationId);
        if (!valid()) return;
        const sdkClient = result.data.client?.id ?? result.data.client?.client_id;
        if ((result.data.client && sdkClient !== trusted.client_id) || (result.data.user && result.data.user.id !== owner.current)) throw new Error("La solicitud no coincide con la cuenta o herramienta verificada.");
        setIdentity(trusted);
        // Previously authorized requests still show the choice before any callback.
        if (result.data.redirect_url) {
          callback.current = result.data.redirect_url;
          setApproved(true);
        }
      } catch (e) {
        if (valid()) setError(e instanceof Error ? e.message : "No se pudo verificar la solicitud.");
      }
    })();
    return () => { active = false; epoch.current++; callback.current = null; subscription.subscription.unsubscribe(); };
  }, [authorizationId, reload]);

  async function connect(selected: ConnectionPermission) {
    if (!identity || locked.current || (selected === "manage" && !managementScopeAllowed(identity.scope))) return;
    locked.current = true; setBusy(true); setError(null);
    const generation = epoch.current;
    const valid = () => epoch.current === generation;
    try {
      const { data, error: userError } = await supabase.auth.getUser();
      if (!valid()) return;
      if (userError || !data.user || data.user.id !== owner.current) throw new Error("La cuenta ha cambiado. Vuelve a cargar la solicitud.");
      const trusted = await authorizationIdentity(authorizationId);
      if (!valid()) return;
      if (trusted.client_id !== identity.client_id || (selected === "manage" && !managementScopeAllowed(trusted.scope))) throw new Error("No se pudo confirmar la herramienta o el permiso solicitado.");
      if (!callback.current) {
        const result = await oauth().approveAuthorization(authorizationId, { skipBrowserRedirect: true });
        if (!valid()) return;
        if (result.error || !result.data?.redirect_url) throw new Error("No se pudo autorizar la conexión. Reintenta.");
        callback.current = result.data.redirect_url;
        setApproved(true);
      }
      await saveConnectionPermission(trusted.client_id, selected);
      if (!valid()) return;
      const target = callback.current;
      if (!target) throw new Error("Vuelve a conectar desde tu asistente.");
      callback.current = null;
      followAuthorizationCallback(target);
    } catch (e) {
      if (valid()) setError(e instanceof Error ? e.message : "No se pudo guardar el permiso.");
    } finally {
      if (valid()) { locked.current = false; setBusy(false); }
    }
  }

  async function cancel() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    const generation = epoch.current;
    try {
      // After approval, cancel locally; never follow the stored success callback.
      if (callback.current) { callback.current = null; setIdentity(null); setApproved(false); setError("Conexión cancelada. Puedes revisar o revocar el acceso en Conexiones de IA."); return; }
      const result = await oauth().denyAuthorization(authorizationId, { skipBrowserRedirect: true });
      if (epoch.current !== generation) return;
      if (result.error || !result.data?.redirect_url) throw new Error("No se pudo cancelar la solicitud. Reintenta.");
      followAuthorizationCallback(result.data.redirect_url);
    } catch (e) { if (epoch.current === generation) setError(e instanceof Error ? e.message : "No se pudo cancelar."); }
    finally { if (epoch.current === generation) { locked.current = false; setBusy(false); } }
  }
  const canManage = identity && managementScopeAllowed(identity.scope);
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-start gap-2 break-words"><ShieldCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden />{identity ? `Conectar ${identity.client_name} a Andromeda` : "Conectar a Andromeda"}</CardTitle>
          <CardDescription className="break-all">{account ? `Cuenta verificada: ${account}` : "Verificando tu cuenta…"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {!identity && !error && <p role="status" className="text-sm text-muted-foreground">Cargando solicitud…</p>}
          {identity && <>
            <p className="text-sm">Elige qué permites a <strong>{identity.client_name}</strong>. Solo podrá acceder a los datos que tu cuenta puede ver.</p>
            <RadioGroup aria-label="Permiso de la conexión" value={permission} onValueChange={value => setPermission(value as ConnectionPermission)} disabled={busy}>
              <div className="flex items-start gap-3 rounded-md border p-4"><RadioGroupItem id="permission-read" value="read" /><Label htmlFor="permission-read" className="space-y-1 cursor-pointer"><span className="block font-semibold">Solo consultar</span><span className="block text-sm font-normal text-muted-foreground">Consultar asuntos, actuaciones, estados, clientes, términos, audiencias y tareas. Sin cambios.</span></Label></div>
              <div className="flex items-start gap-3 rounded-md border border-primary/50 p-4"><RadioGroupItem id="permission-manage" value="manage" disabled={!canManage} /><Label htmlFor="permission-manage" className="space-y-1 cursor-pointer"><span className="block font-semibold">Consultar y gestionar</span><span className="block text-sm font-normal text-muted-foreground">Hacer cambios en tus asuntos propios cuando tú se lo pidas.</span></Label></div>
            </RadioGroup>
            {!canManage && <p className="text-sm text-muted-foreground">Esta herramienta solicitó únicamente consulta. Para gestionar, vuelve a conectarla con un permiso más amplio.</p>}
            <div className="space-y-2 text-sm"><p className="font-medium">La gestión permite</p><ul className="list-disc pl-5 space-y-1 text-muted-foreground">{MANAGEMENT_SCOPE.map(text => <li key={text}>{text}</li>)}</ul><p className="text-muted-foreground">{MANAGEMENT_BOUNDARY}</p></div>
          </>}
          <p className="text-sm text-muted-foreground">Puedes cambiar el permiso o revocar el acceso después en <Link className="underline text-primary" to={AI_CONNECTIONS_PATH}>Configuración → Conexiones de IA</Link>.</p>
        </CardContent>
        {identity && <CardFooter className="flex flex-wrap gap-3 justify-end">
          <Button variant="outline" disabled={busy} onClick={() => void cancel()}>Cancelar</Button>
          {approved && error && <Button variant="outline" disabled={busy} onClick={() => { setPermission("read"); void connect("read"); }}>Continuar solo lectura</Button>}
          <Button className="h-auto min-h-10 whitespace-normal" disabled={busy} onClick={() => void connect(permission)}>{busy ? "Guardando permiso…" : approved && error ? "Reintentar guardar y verificar permiso" : permission === "manage" ? "Conectar y permitir gestión" : "Conectar con solo lectura"}</Button>
        </CardFooter>}
      </Card>
    </main>
  );
}
