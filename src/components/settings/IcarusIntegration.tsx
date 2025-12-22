import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Cloud, 
  CloudOff, 
  RefreshCw, 
  Link2, 
  Unlink, 
  AlertCircle, 
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  HelpCircle
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function IcarusIntegration() {
  const queryClient = useQueryClient();
  const [cookieInput, setCookieInput] = useState("");
  const [showCookie, setShowCookie] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const { data: integration, isLoading } = useQuery({
    queryKey: ["icarus-integration"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      
      const { data, error } = await supabase
        .from("integrations")
        .select("*")
        .eq("owner_id", user.id)
        .eq("provider", "ICARUS")
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
  });

  const { data: lastSyncRun } = useQuery({
    queryKey: ["icarus-last-sync"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      
      const { data, error } = await supabase
        .from("icarus_sync_runs")
        .select("*")
        .eq("owner_id", user.id)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
  });

  const testConnection = useMutation({
    mutationFn: async (cookie: string) => {
      const { data, error } = await supabase.functions.invoke("adapter-icarus", {
        body: { action: "test", cookie },
      });
      if (error) throw error;
      if (!data.ok) throw new Error(data.error || "Connection failed");
      return data;
    },
    onSuccess: () => {
      toast.success("Conexión exitosa a ICARUS");
    },
    onError: (error) => {
      toast.error("Error de conexión: " + error.message);
    },
  });

  const saveIntegration = useMutation({
    mutationFn: async (cookie: string) => {
      const { data, error } = await supabase.functions.invoke("adapter-icarus", {
        body: { action: "save", cookie },
      });
      if (error) throw error;
      if (!data.ok) throw new Error(data.error || "Save failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["icarus-integration"] });
      setCookieInput("");
      toast.success("Integración ICARUS guardada");
    },
    onError: (error) => {
      toast.error("Error al guardar: " + error.message);
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      
      const { error } = await supabase
        .from("integrations")
        .delete()
        .eq("owner_id", user.id)
        .eq("provider", "ICARUS");
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["icarus-integration"] });
      toast.success("Integración ICARUS desconectada");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const syncNow = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("icarus-sync", {
        body: { mode: "manual", fullSync: true },
      });
      if (error) throw error;
      if (!data.ok) throw new Error(data.error || "Sync failed");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["icarus-integration"] });
      queryClient.invalidateQueries({ queryKey: ["icarus-last-sync"] });
      queryClient.invalidateQueries({ queryKey: ["monitored-processes"] });
      toast.success(`Sincronización completada: ${data.events_created || 0} eventos nuevos`);
    },
    onError: (error) => {
      toast.error("Error en sincronización: " + error.message);
    },
  });

  const isConnected = integration?.status === "CONNECTED";
  const isPending = testConnection.isPending || saveIntegration.isPending || syncNow.isPending;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center text-muted-foreground">
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            Cargando...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isConnected ? (
            <Cloud className="h-5 w-5 text-green-500" />
          ) : (
            <CloudOff className="h-5 w-5 text-muted-foreground" />
          )}
          Integración ICARUS
        </CardTitle>
        <CardDescription>
          Sincroniza tus procesos desde tu cuenta de ICARUS automáticamente
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status Badge */}
        <div className="flex items-center gap-4">
          <Badge 
            variant={isConnected ? "default" : "secondary"}
            className={isConnected ? "bg-green-500/20 text-green-700 border-green-500/30" : ""}
          >
            {isConnected ? (
              <>
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Conectado
              </>
            ) : (
              <>
                <AlertCircle className="h-3 w-3 mr-1" />
                Desconectado
              </>
            )}
          </Badge>
          
          {integration?.secret_last4 && (
            <span className="text-sm text-muted-foreground">
              Cookie: ****{integration.secret_last4}
            </span>
          )}
          
          {integration?.last_sync_at && (
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Última sync: {formatDistanceToNow(new Date(integration.last_sync_at), { 
                addSuffix: true, 
                locale: es 
              })}
            </span>
          )}
        </div>

        {/* Error Display */}
        {integration?.status === "ERROR" && integration?.last_error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{integration.last_error}</AlertDescription>
          </Alert>
        )}

        {/* Last Sync Run Info */}
        {lastSyncRun && (
          <div className="p-3 bg-muted rounded-lg text-sm">
            <div className="flex items-center justify-between">
              <span>
                Último intento: {lastSyncRun.status} 
                {lastSyncRun.processes_found !== null && ` - ${lastSyncRun.processes_found} procesos`}
                {lastSyncRun.events_created !== null && `, ${lastSyncRun.events_created} eventos nuevos`}
              </span>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => window.open(`/process-status/test-icarus?run=${lastSyncRun.id}`, '_blank')}
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                Ver diagnóstico
              </Button>
            </div>
          </div>
        )}

        {/* Connection Form */}
        {!isConnected && (
          <div className="space-y-4">
            <Collapsible open={isHelpOpen} onOpenChange={setIsHelpOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
                  <HelpCircle className="h-4 w-4 mr-2" />
                  ¿Cómo obtener la cookie de sesión?
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <div className="p-4 bg-muted rounded-lg text-sm space-y-2">
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Ingresa a <strong>ICARUS</strong> en tu navegador e inicia sesión</li>
                    <li>Abre las <strong>Herramientas de Desarrollador</strong> (F12)</li>
                    <li>Ve a la pestaña <strong>Application</strong> (Chrome) o <strong>Storage</strong> (Firefox)</li>
                    <li>En el panel izquierdo, expande <strong>Cookies</strong></li>
                    <li>Busca la cookie de sesión (generalmente <code>JSESSIONID</code> o similar)</li>
                    <li>Copia el <strong>valor</strong> de la cookie (no el nombre)</li>
                    <li>Pégalo aquí en el campo de abajo</li>
                  </ol>
                  <p className="text-xs text-muted-foreground mt-2">
                    ⚠️ La cookie expira cuando cierras sesión en ICARUS. Deberás actualizarla periódicamente.
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div className="space-y-2">
              <Label htmlFor="icarus-cookie">Cookie de Sesión ICARUS</Label>
              <div className="relative">
                <Input
                  id="icarus-cookie"
                  type={showCookie ? "text" : "password"}
                  value={cookieInput}
                  onChange={(e) => setCookieInput(e.target.value)}
                  placeholder="Pega aquí la cookie de sesión..."
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowCookie(!showCookie)}
                >
                  {showCookie ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => testConnection.mutate(cookieInput)}
                disabled={!cookieInput || isPending}
              >
                {testConnection.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4 mr-2" />
                )}
                Probar Conexión
              </Button>
              <Button
                onClick={() => saveIntegration.mutate(cookieInput)}
                disabled={!cookieInput || isPending}
              >
                {saveIntegration.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Guardar
              </Button>
            </div>
          </div>
        )}

        {/* Connected Actions */}
        {isConnected && (
          <div className="flex gap-2">
            <Button
              onClick={() => syncNow.mutate()}
              disabled={isPending}
            >
              {syncNow.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Sincronizar Ahora
            </Button>
            <Button
              variant="outline"
              onClick={() => disconnect.mutate()}
              disabled={isPending}
            >
              <Unlink className="h-4 w-4 mr-2" />
              Desconectar
            </Button>
          </div>
        )}

        {/* Info */}
        <p className="text-xs text-muted-foreground">
          La sincronización automática se ejecuta diariamente a las 7:00 AM (hora Colombia).
          Los procesos y movimientos de ICARUS se importarán a tu lista de procesos monitoreados.
        </p>
      </CardContent>
    </Card>
  );
}