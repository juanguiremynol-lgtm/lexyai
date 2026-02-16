/**
 * PlatformAuthProvidersPage — Super admin page for managing auth providers.
 * Shows provider tiles with status and enable/disable toggles.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, ShieldX, KeyRound, Info } from "lucide-react";
import { toast } from "sonner";

interface AuthProvider {
  id: string;
  provider_key: string;
  display_name: string;
  enabled: boolean;
  required_secret_keys: string[];
  status: string;
  notes: string | null;
}

export default function PlatformAuthProvidersPage() {
  const queryClient = useQueryClient();

  const { data: providers, isLoading } = useQuery({
    queryKey: ["auth-provider-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auth_provider_settings")
        .select("*")
        .order("created_at");
      if (error) throw error;
      return data as AuthProvider[];
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("auth_provider_settings")
        .update({ enabled, status: enabled ? "configured" : "disabled" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-provider-settings"] });
      toast.success("Proveedor actualizado");
    },
    onError: (err: any) => {
      toast.error("Error: " + err.message);
    },
  });

  const statusBadge = (p: AuthProvider) => {
    if (p.status === "configured" && p.enabled) {
      return <Badge className="bg-green-500/15 text-green-600 border-green-500/30"><ShieldCheck className="h-3 w-3 mr-1" />Configurado</Badge>;
    }
    if (p.required_secret_keys.length > 0 && !p.enabled) {
      return <Badge variant="outline" className="text-amber-500 border-amber-500/30"><KeyRound className="h-3 w-3 mr-1" />Secrets pendientes</Badge>;
    }
    return <Badge variant="outline" className="text-muted-foreground"><ShieldX className="h-3 w-3 mr-1" />Deshabilitado</Badge>;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Proveedores de Autenticación</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestiona los métodos de inicio de sesión disponibles para los usuarios.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {providers?.map((p) => (
          <Card key={p.id} className="relative">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{p.display_name}</CardTitle>
                <Switch
                  checked={p.enabled}
                  onCheckedChange={(checked) => toggleMutation.mutate({ id: p.id, enabled: checked })}
                  disabled={toggleMutation.isPending}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {statusBadge(p)}
              {p.required_secret_keys.length > 0 && (
                <div className="flex items-start gap-1.5 text-xs text-muted-foreground mt-2">
                  <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>Secrets requeridos: {p.required_secret_keys.join(", ")}</span>
                </div>
              )}
              {p.notes && (
                <p className="text-xs text-muted-foreground">{p.notes}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
