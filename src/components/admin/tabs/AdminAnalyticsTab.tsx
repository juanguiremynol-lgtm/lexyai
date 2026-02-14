/**
 * Admin Analytics Tab — Per-org analytics overrides
 * Org admins can opt-out or narrow allowlists for their organization.
 * Inherits global settings unless overridden.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { BarChart3, Shield, Info, Save, RotateCcw } from "lucide-react";

interface OrgOverride {
  id?: string;
  analytics_enabled: boolean | null;
  session_replay_enabled: boolean | null;
  allowed_properties_override: string[] | null;
  notes: string | null;
}

interface GlobalState {
  analytics_enabled_global: boolean;
  session_replay_enabled: boolean;
}

export function AdminAnalyticsTab() {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();
  const orgId = organization?.id;

  // Fetch global settings for context
  const { data: global } = useQuery({
    queryKey: ["admin-analytics-global"],
    queryFn: async (): Promise<GlobalState> => {
      const { data } = await supabase
        .from("platform_settings")
        .select("analytics_enabled_global, session_replay_enabled")
        .eq("id", "singleton")
        .single();
      return (data || { analytics_enabled_global: false, session_replay_enabled: false }) as GlobalState;
    },
  });

  // Fetch org override
  const { data: override, isLoading } = useQuery({
    queryKey: ["admin-analytics-override", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<OrgOverride | null> => {
      const { data } = await (supabase.from("org_analytics_overrides") as any)
        .select("*")
        .eq("organization_id", orgId)
        .maybeSingle();
      return data || null;
    },
  });

  // Local state for editing
  const [localEnabled, setLocalEnabled] = useState<boolean | null>(null);
  const [localReplay, setLocalReplay] = useState<boolean | null>(null);
  const [localNotes, setLocalNotes] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);

  // Sync local state when data loads
  const effectiveEnabled = localEnabled ?? override?.analytics_enabled ?? null;
  const effectiveReplay = localReplay ?? override?.session_replay_enabled ?? null;
  const effectiveNotes = isDirty ? localNotes : (override?.notes || "");

  // Upsert mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No org");
      const payload = {
        organization_id: orgId,
        analytics_enabled: effectiveEnabled,
        session_replay_enabled: effectiveReplay,
        notes: effectiveNotes || null,
      };
      const { error } = await (supabase.from("org_analytics_overrides") as any)
        .upsert(payload, { onConflict: "organization_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-analytics-override", orgId] });
      toast.success("Configuración de analíticas guardada");
      setIsDirty(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resetToInherit = () => {
    setLocalEnabled(null);
    setLocalReplay(null);
    setLocalNotes("");
    setIsDirty(true);
  };

  // Resolve effective state
  const resolvedEnabled = effectiveEnabled === null
    ? (global?.analytics_enabled_global ?? false)
    : effectiveEnabled;
  const resolvedReplay = effectiveReplay === null
    ? (global?.session_replay_enabled ?? false)
    : effectiveReplay;

  if (isLoading) {
    return <div className="text-muted-foreground py-8 text-center text-sm">Cargando…</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <CardTitle>Analíticas y Telemetría</CardTitle>
          </div>
          <CardDescription>
            Controla qué datos de uso se recopilan para tu organización.
            Las configuraciones heredan los valores globales de la plataforma salvo override explícito.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Global state banner */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>Estado global:</strong>{" "}
              Analíticas {global?.analytics_enabled_global ? "habilitadas" : "deshabilitadas"} a nivel de plataforma.
              {" "}Session Replay {global?.session_replay_enabled ? "habilitado" : "deshabilitado"}.
            </AlertDescription>
          </Alert>

          {/* Analytics toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
            <div>
              <Label className="font-medium">Analíticas para esta organización</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {effectiveEnabled === null ? (
                  <Badge variant="outline" className="text-xs">Heredado del global</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">Override local</Badge>
                )}
                {" · "}Efectivo: {resolvedEnabled ? "✅ Activo" : "❌ Inactivo"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {effectiveEnabled === null ? "Auto" : effectiveEnabled ? "ON" : "OFF"}
              </span>
              <Switch
                checked={resolvedEnabled}
                onCheckedChange={(v) => {
                  setLocalEnabled(v);
                  setIsDirty(true);
                }}
              />
            </div>
          </div>

          {/* Session Replay toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
            <div>
              <Label className="font-medium">Session Replay</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Grabación de sesión (inputs enmascarados, documentos excluidos)
                {" · "}
                {effectiveReplay === null ? (
                  <Badge variant="outline" className="text-xs">Heredado</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">Override</Badge>
                )}
              </p>
            </div>
            <Switch
              checked={resolvedReplay}
              onCheckedChange={(v) => {
                setLocalReplay(v);
                setIsDirty(true);
              }}
            />
          </div>

          <Separator />

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notas de cumplimiento</Label>
            <Textarea
              value={effectiveNotes}
              onChange={(e) => {
                setLocalNotes(e.target.value);
                setIsDirty(true);
              }}
              placeholder="Ej: Cliente requiere opt-out total de telemetría por política interna..."
              className="min-h-[60px]"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="gap-1"
            >
              <Save className="h-3.5 w-3.5" />
              Guardar
            </Button>
            <Button
              variant="outline"
              onClick={resetToInherit}
              className="gap-1"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restaurar a herencia global
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Privacy reminder */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Compromiso de privacidad</p>
              <p className="text-xs text-muted-foreground mt-1">
                Atenia nunca recopila, almacena ni envía contenidos de casos judiciales, nombres de partes,
                documentos, correos electrónicos, ni información personal identificable a servicios de analíticas.
                Todos los identificadores se procesan con hash criptográfico (HMAC-SHA256) antes de cualquier transmisión.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
