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
  LogIn
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

export function IcarusIntegration() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

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

  const login = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const { data, error } = await supabase.functions.invoke("icarus-auth", {
        body: { action: "login", username, password },
      });
      if (error) throw error;
      if (!data.ok) throw new Error(data.error || "Login failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["icarus-integration"] });
      setUsername("");
      setPassword("");
      toast.success("Conexión ICARUS exitosa");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
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
      toast.success(`Sincronización: ${data.processes_found || 0} procesos, ${data.events_created || 0} eventos nuevos`);
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const isConnected = integration?.status === "CONNECTED";
  const needsReauth = integration?.status === "NEEDS_REAUTH" || integration?.status === "AUTH_FAILED";
  const isPending = login.isPending || syncNow.isPending;

  const getStatusBadge = () => {
    if (isConnected) {
      return (
        <Badge className="bg-green-500/20 text-green-700 border-green-500/30">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Conectado
        </Badge>
      );
    }
    if (needsReauth) {
      return (
        <Badge variant="destructive">
          <AlertCircle className="h-3 w-3 mr-1" />
          Requiere reconexión
        </Badge>
      );
    }
    if (integration?.status === "CAPTCHA_REQUIRED") {
      return (
        <Badge variant="destructive">
          <AlertCircle className="h-3 w-3 mr-1" />
          CAPTCHA detectado
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <CloudOff className="h-3 w-3 mr-1" />
        Desconectado
      </Badge>
    );
  };

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
          Sincroniza tus procesos desde ICARUS con tus credenciales de acceso
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status */}
        <div className="flex items-center gap-4 flex-wrap">
          {getStatusBadge()}
          
          {integration?.username && (
            <span className="text-sm text-muted-foreground">
              Usuario: {integration.username}
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
        {integration?.last_error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{integration.last_error}</AlertDescription>
          </Alert>
        )}

        {/* Last Sync Run Info */}
        {lastSyncRun && (
          <div className="p-3 bg-muted rounded-lg text-sm">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span>
                Último resultado: <strong>{lastSyncRun.classification || lastSyncRun.status}</strong>
                {lastSyncRun.processes_found !== null && ` — ${lastSyncRun.processes_found} procesos`}
                {lastSyncRun.events_created !== null && `, ${lastSyncRun.events_created} eventos nuevos`}
              </span>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => window.open(`/process-status/test-icarus?run=${lastSyncRun.id}`, '_blank')}
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                Diagnóstico
              </Button>
            </div>
          </div>
        )}

        {/* Login Form */}
        {(!isConnected || needsReauth) && (
          <div className="space-y-4 border rounded-lg p-4">
            <div className="space-y-2">
              <Label htmlFor="icarus-username">Usuario ICARUS (email)</Label>
              <Input
                id="icarus-username"
                type="email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="usuario@ejemplo.com"
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="icarus-password">Contraseña</Label>
              <div className="relative">
                <Input
                  id="icarus-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                  autoComplete="current-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <Button
              onClick={() => login.mutate({ username, password })}
              disabled={!username || !password || isPending}
              className="w-full"
            >
              {login.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4 mr-2" />
              )}
              {needsReauth ? "Reconectar" : "Conectar a ICARUS"}
            </Button>

            <p className="text-xs text-muted-foreground">
              Tus credenciales se almacenan encriptadas y solo se usan para sincronizar tus procesos.
            </p>
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

        <p className="text-xs text-muted-foreground">
          La sincronización automática se ejecuta diariamente a las 7:00 AM (hora Colombia).
        </p>
      </CardContent>
    </Card>
  );
}
