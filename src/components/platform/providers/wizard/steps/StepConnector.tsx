/**
 * Step 2 — Connector Definition (Contract + Allowlist)
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, ArrowRight, Copy, Plus, Shield, Trash2, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WizardExplanation } from "../WizardExplanation";
import type { WizardMode, WizardConnector } from "../WizardTypes";

interface StepConnectorProps {
  mode: WizardMode;
  isNew: boolean;
  connector: WizardConnector | null;
  organizationId: string | null;
  onConnectorSaved: (c: WizardConnector) => void;
  onNext: () => void;
}

export function StepConnector({ mode, isNew, connector, organizationId, onConnectorSaved, onNext }: StepConnectorProps) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState(connector?.key || "");
  const [name, setName] = useState(connector?.name || "");
  const [description, setDescription] = useState(connector?.description || "");
  const [capabilities, setCapabilities] = useState(connector?.capabilities?.join(", ") || "ACTUACIONES, PUBLICACIONES");
  const [allowedDomains, setAllowedDomains] = useState<string[]>(connector?.allowed_domains?.length ? connector.allowed_domains : [""]);
  const [schemaVersion, setSchemaVersion] = useState(connector?.schema_version || "atenia.v1");
  const [wildcardAck, setWildcardAck] = useState(false);

  useEffect(() => {
    if (connector && !isNew) {
      setKey(connector.key);
      setName(connector.name);
      setDescription(connector.description || "");
      setCapabilities(connector.capabilities?.join(", ") || "");
      setAllowedDomains(connector.allowed_domains?.length ? connector.allowed_domains : [""]);
      setSchemaVersion(connector.schema_version || "atenia.v1");
    }
  }, [connector, isNew]);

  const hasWildcard = allowedDomains.some((d) => d.includes("*"));
  const domainsEmpty = allowedDomains.filter((d) => d.trim()).length === 0;
  const canSave = !domainsEmpty && key.trim() && name.trim() && (!hasWildcard || wildcardAck);
  const alreadySaved = !isNew && connector;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cleanDomains = allowedDomains.map((d) => d.trim()).filter(Boolean);
      if (cleanDomains.length === 0) throw new Error("allowed_domains requerido");

      const visibility = mode === "PLATFORM" ? "GLOBAL" : "ORG_PRIVATE";
      const { data, error } = await supabase.functions.invoke("provider-create-connector", {
        body: {
          key: key.trim(),
          name: name.trim(),
          description: description.trim() || null,
          capabilities: capabilities.split(",").map((c) => c.trim()).filter(Boolean),
          allowed_domains: cleanDomains,
          schema_version: schemaVersion,
          visibility,
          organization_id: visibility === "ORG_PRIVATE" ? organizationId : undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.connector as WizardConnector;
    },
    onSuccess: (c) => {
      toast.success("Conector guardado");
      queryClient.invalidateQueries({ queryKey: ["wizard-connectors"] });
      queryClient.invalidateQueries({ queryKey: ["provider-connectors"] });
      onConnectorSaved(c);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addDomain = () => setAllowedDomains((prev) => [...prev, ""]);
  const removeDomain = (idx: number) => setAllowedDomains((prev) => prev.filter((_, i) => i !== idx));
  const updateDomain = (idx: number, val: string) =>
    setAllowedDomains((prev) => prev.map((d, i) => (i === idx ? val : d)));

  const copyConfig = () => {
    const config = { key, name, capabilities: capabilities.split(",").map((c) => c.trim()), allowed_domains: allowedDomains.filter(Boolean), schema_version: schemaVersion };
    navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    toast.success("JSON copiado");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-display font-semibold text-foreground">
            {isNew ? "Definir Conector" : "Revisar Conector"}
          </h2>
          <Button size="sm" variant="ghost" onClick={copyConfig}>
            <Copy className="h-4 w-4 mr-1" /> Copiar JSON
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Key (único)</Label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="my_provider_v1" disabled={!isNew} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mi Proveedor API" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Descripción</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción del proveedor..." className="min-h-[60px]" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Capabilities (comma-separated)</Label>
            <Input value={capabilities} onChange={(e) => setCapabilities(e.target.value)} placeholder="ACTUACIONES, PUBLICACIONES" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Schema Version</Label>
            <Input value={schemaVersion} onChange={(e) => setSchemaVersion(e.target.value)} />
          </div>
        </div>

        {/* Allowed Domains */}
        <div className="space-y-2 border border-border/50 rounded-lg p-4 bg-muted/20">
          <Label className="text-xs text-muted-foreground flex items-center gap-2">
            <Shield className="h-3.5 w-3.5" />
            Dominios Permitidos (SSRF allowlist)
            {domainsEmpty && <Badge variant="destructive" className="text-[10px]">Requerido</Badge>}
          </Label>
          {allowedDomains.map((domain, idx) => (
            <div key={idx} className="flex gap-2">
              <Input value={domain} onChange={(e) => updateDomain(idx, e.target.value)} placeholder="my-api.example.com" disabled={!isNew} />
              {allowedDomains.length > 1 && isNew && (
                <Button size="icon" variant="ghost" onClick={() => removeDomain(idx)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          ))}
          {isNew && (
            <Button size="sm" variant="outline" onClick={addDomain}>
              <Plus className="h-3 w-3 mr-1" /> Agregar dominio
            </Button>
          )}

          {hasWildcard && (
            <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 space-y-2">
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Wildcard detectado. Los wildcards amplían la superficie SSRF.
              </p>
              <div className="flex items-center gap-2">
                <Checkbox id="wildcard-ack" checked={wildcardAck} onCheckedChange={(v) => setWildcardAck(!!v)} />
                <label htmlFor="wildcard-ack" className="text-xs text-muted-foreground">
                  Entiendo el riesgo y acepto usar wildcards en producción
                </label>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-2.5">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            <span>Solo HTTPS permitido. IPs privadas y localhost están bloqueados. Prefiera hostnames exactos.</span>
          </div>
        </div>

        <div className="flex justify-between items-center">
          {isNew ? (
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !canSave}
            >
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Guardar Conector
            </Button>
          ) : (
            <div />
          )}
          <Button onClick={onNext} disabled={!alreadySaved && !saveMutation.isSuccess} className="gap-2">
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="lg:col-span-2">
        <WizardExplanation
          title="Contrato + Allowlist"
          whatItDoes="Define los dominios donde este proveedor puede hacer llamadas (SSRF allowlist), las capacidades que expone, y la versión de esquema para garantizar compatibilidad."
          whyItMatters="La allowlist previene ataques SSRF al restringir las URLs que el sistema puede consultar. Los proveedores deben exponer /health, /capabilities, /resolve y /snapshot — no se permite scraping arbitrario."
          commonMistakes={[
            "Allowlist vacía — el conector no podrá hacer ninguna llamada",
            "Usar *.run.app en producción — demasiado permisivo",
            "Olvidar incluir el subdominio exacto de staging vs producción",
          ]}
        />
      </div>
    </div>
  );
}
