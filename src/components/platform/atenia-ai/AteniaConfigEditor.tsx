/**
 * AteniaConfigEditor — Editable settings for Atenia AI per-org config
 */

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Settings, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { loadConfig, saveConfig, type AteniaConfig } from "@/lib/services/atenia-ai-engine";

interface Props {
  organizationId: string;
}

export function AteniaConfigEditor({ organizationId }: Props) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<AteniaConfig | null>(null);

  const { data: config, isLoading } = useQuery({
    queryKey: ['atenia-config', organizationId],
    queryFn: () => loadConfig(organizationId),
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (config && !form) {
      setForm({ ...config });
    }
  }, [config, form]);

  const handleSave = async () => {
    if (!form) return;
    setIsSaving(true);
    try {
      await saveConfig(organizationId, form);
      toast.success('Configuración guardada');
      queryClient.invalidateQueries({ queryKey: ['atenia-config'] });
    } catch {
      toast.error('Error al guardar configuración');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !form) {
    return (
      <Card>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Configuración de Atenia AI
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Gemini Kill Switch */}
        <div className="space-y-2 p-3 rounded-lg border-2 border-destructive/20 bg-destructive/5">
          <div className="flex items-center justify-between">
            <Label className="font-medium">Integración con Google Gemini</Label>
            <Switch
              checked={form.gemini_enabled}
              onCheckedChange={(v) => setForm({ ...form, gemini_enabled: v })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {form.gemini_enabled
              ? '✅ Gemini activo — análisis inteligente, enriquecimiento de alertas y auditorías funcionando.'
              : '⛔ Gemini DESACTIVADO — todas las llamadas a la IA están suspendidas. Solo se ejecutan reglas automáticas sin IA.'}
          </p>
        </div>

        {/* Auto-demonitor */}
        <div className="space-y-2">
          <Label>Autonomía de Monitoreo</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Auto-suspender después de</span>
            <Input
              type="number"
              min={2}
              max={20}
              className="w-16 h-8"
              value={form.auto_demonitor_after_404s}
              onChange={(e) => setForm({ ...form, auto_demonitor_after_404s: parseInt(e.target.value) || 5 })}
            />
            <span className="text-sm text-muted-foreground">consultas 404 consecutivas</span>
          </div>
        </div>

        {/* Stage inference mode */}
        <div className="space-y-2">
          <Label>Inferencia de Etapa</Label>
          <RadioGroup
            value={form.stage_inference_mode}
            onValueChange={(v) => setForm({ ...form, stage_inference_mode: v as AteniaConfig['stage_inference_mode'] })}
            className="space-y-1"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="suggest" id="stage-suggest" />
              <Label htmlFor="stage-suggest" className="text-sm font-normal">
                Sugerir cambios (usuario aprueba)
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="auto_with_confirm" id="stage-auto" />
              <Label htmlFor="stage-auto" className="text-sm font-normal">
                Auto-aplicar con confirmación (48h timeout)
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="off" id="stage-off" />
              <Label htmlFor="stage-off" className="text-sm font-normal">
                Desactivado
              </Label>
            </div>
          </RadioGroup>
        </div>

        {/* Alert enrichment */}
        <div className="flex items-center justify-between">
          <div>
            <Label>Alertas Inteligentes</Label>
            <p className="text-xs text-muted-foreground">Enriquecer alertas con análisis de Gemini</p>
          </div>
          <Switch
            checked={form.alert_ai_enrichment}
            onCheckedChange={(v) => setForm({ ...form, alert_ai_enrichment: v })}
            disabled={!form.gemini_enabled}
          />
        </div>

        {/* Provider thresholds */}
        <div className="space-y-2">
          <Label>Umbrales de Salud de Proveedores</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Latencia lenta (ms)</span>
              <Input
                type="number"
                min={1000}
                max={30000}
                step={500}
                className="h-8"
                value={form.provider_slow_threshold_ms}
                onChange={(e) => setForm({ ...form, provider_slow_threshold_ms: parseInt(e.target.value) || 5000 })}
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Tasa error degradada (%)</span>
              <Input
                type="number"
                min={5}
                max={100}
                className="h-8"
                value={Math.round(form.provider_error_rate_threshold * 100)}
                onChange={(e) => setForm({ ...form, provider_error_rate_threshold: (parseInt(e.target.value) || 30) / 100 })}
              />
            </div>
          </div>
        </div>

        {/* Email alerts */}
        <div className="flex items-center justify-between">
          <div>
            <Label>Alertas por Email</Label>
            <p className="text-xs text-muted-foreground">Enviar alertas críticas por correo electrónico</p>
          </div>
          <Switch
            checked={form.email_alerts_enabled}
            onCheckedChange={(v) => setForm({ ...form, email_alerts_enabled: v })}
          />
        </div>

        <Button onClick={handleSave} disabled={isSaving} className="w-full gap-2">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar Configuración
        </Button>
      </CardContent>
    </Card>
  );
}
