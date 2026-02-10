/**
 * ConnectorEditorCard — Create/update global provider connector templates.
 * Validates allowed_domains non-empty, warns on wildcards.
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Check, Copy, Plus, Trash2, Shield, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface Connector {
  id: string;
  key: string;
  name: string;
  description: string | null;
  capabilities: string[];
  allowed_domains: string[];
  schema_version: string;
  is_enabled: boolean;
  created_at: string;
}

type ConnectorStatus = "NOT_CONFIGURED" | "NEEDS_REVIEW" | "READY" | "ERROR";

function getConnectorStatus(connector: Connector | null): ConnectorStatus {
  if (!connector) return "NOT_CONFIGURED";
  if (!connector.allowed_domains || connector.allowed_domains.length === 0) return "ERROR";
  if (connector.allowed_domains.some((d) => d.includes("*"))) return "NEEDS_REVIEW";
  if (!connector.is_enabled) return "NEEDS_REVIEW";
  return "READY";
}

function StatusBadge({ status }: { status: ConnectorStatus }) {
  const map = {
    NOT_CONFIGURED: { label: "No configurado", variant: "outline" as const, className: "text-slate-400 border-slate-600" },
    NEEDS_REVIEW: { label: "Necesita revisión", variant: "outline" as const, className: "text-amber-400 border-amber-500/50 bg-amber-500/10" },
    READY: { label: "Listo", variant: "outline" as const, className: "text-emerald-400 border-emerald-500/50 bg-emerald-500/10" },
    ERROR: { label: "Error", variant: "destructive" as const, className: "" },
  };
  const s = map[status];
  return <Badge variant={s.variant} className={s.className}>{s.label}</Badge>;
}

interface ConnectorEditorCardProps {
  selectedConnector: Connector | null;
  onConnectorChange: (c: Connector | null) => void;
}

export function ConnectorEditorCard({ selectedConnector, onConnectorChange }: ConnectorEditorCardProps) {
  const queryClient = useQueryClient();

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [capabilities, setCapabilities] = useState("ACTUACIONES, PUBLICACIONES");
  const [allowedDomains, setAllowedDomains] = useState<string[]>([""]);
  const [schemaVersion, setSchemaVersion] = useState("atenia.v1");
  const [isEnabled, setIsEnabled] = useState(true);
  const [isEditing, setIsEditing] = useState(false);

  // Load existing connectors
  const { data: connectors, isLoading } = useQuery({
    queryKey: ["provider-connectors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_connectors")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Connector[];
    },
  });

  // When a connector is selected, populate form
  useEffect(() => {
    if (selectedConnector) {
      setKey(selectedConnector.key);
      setName(selectedConnector.name);
      setDescription(selectedConnector.description || "");
      setCapabilities((selectedConnector.capabilities || []).join(", "));
      setAllowedDomains(selectedConnector.allowed_domains?.length ? selectedConnector.allowed_domains : [""]);
      setSchemaVersion(selectedConnector.schema_version || "atenia.v1");
      setIsEnabled(selectedConnector.is_enabled);
      setIsEditing(true);
    }
  }, [selectedConnector]);

  const hasWildcard = allowedDomains.some((d) => d.includes("*"));
  const domainsEmpty = allowedDomains.filter((d) => d.trim()).length === 0;

  const createMutation = useMutation({
    mutationFn: async () => {
      const cleanDomains = allowedDomains.map((d) => d.trim()).filter(Boolean);
      if (cleanDomains.length === 0) throw new Error("allowed_domains no puede estar vacío");
      
      const { data, error } = await supabase.functions.invoke("provider-create-connector", {
        body: {
          key: key.trim(),
          name: name.trim(),
          description: description.trim() || null,
          capabilities: capabilities.split(",").map((c) => c.trim()).filter(Boolean),
          allowed_domains: cleanDomains,
          schema_version: schemaVersion,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.connector as Connector;
    },
    onSuccess: (connector) => {
      toast.success("Conector creado exitosamente");
      queryClient.invalidateQueries({ queryKey: ["provider-connectors"] });
      onConnectorChange(connector);
      setIsEditing(true);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedConnector) throw new Error("No connector selected");
      const cleanDomains = allowedDomains.map((d) => d.trim()).filter(Boolean);
      if (cleanDomains.length === 0) throw new Error("allowed_domains no puede estar vacío");

      // Direct update via service role (platform admin has RLS access)
      const { data, error } = await supabase
        .from("provider_connectors")
        .update({
          name: name.trim(),
          description: description.trim() || null,
          capabilities: capabilities.split(",").map((c) => c.trim()).filter(Boolean),
          allowed_domains: cleanDomains,
          schema_version: schemaVersion,
          is_enabled: isEnabled,
        })
        .eq("id", selectedConnector.id)
        .select()
        .single();
      if (error) throw error;
      return data as Connector;
    },
    onSuccess: (connector) => {
      toast.success("Conector actualizado");
      queryClient.invalidateQueries({ queryKey: ["provider-connectors"] });
      onConnectorChange(connector);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addDomain = () => setAllowedDomains((prev) => [...prev, ""]);
  const removeDomain = (idx: number) => setAllowedDomains((prev) => prev.filter((_, i) => i !== idx));
  const updateDomain = (idx: number, val: string) =>
    setAllowedDomains((prev) => prev.map((d, i) => (i === idx ? val : d)));

  const resetForm = () => {
    setKey("");
    setName("");
    setDescription("");
    setCapabilities("ACTUACIONES, PUBLICACIONES");
    setAllowedDomains([""]);
    setSchemaVersion("atenia.v1");
    setIsEnabled(true);
    setIsEditing(false);
    onConnectorChange(null);
  };

  const copyConfig = () => {
    const config = {
      key, name, description, capabilities: capabilities.split(",").map((c) => c.trim()),
      allowed_domains: allowedDomains.filter((d) => d.trim()),
      schema_version: schemaVersion, is_enabled: isEnabled,
    };
    navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    toast.success("Configuración copiada");
  };

  const status = getConnectorStatus(selectedConnector);
  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <Card className="border-slate-700 bg-slate-900/50">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5 text-amber-400" />
            A) Conector Template (Global)
          </CardTitle>
          <CardDescription>Define el template de conector con dominios permitidos y capacidades</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          <Button size="sm" variant="ghost" onClick={copyConfig}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Connector selector */}
        {connectors && connectors.length > 0 && (
          <div className="space-y-2">
            <Label className="text-slate-300">Conectores existentes</Label>
            <div className="flex flex-wrap gap-2">
              {connectors.map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant={selectedConnector?.id === c.id ? "default" : "outline"}
                  className={selectedConnector?.id === c.id ? "bg-amber-600 hover:bg-amber-700" : "border-slate-600"}
                  onClick={() => onConnectorChange(c)}
                >
                  {c.name} ({c.key})
                </Button>
              ))}
              <Button size="sm" variant="outline" className="border-dashed border-slate-600" onClick={resetForm}>
                <Plus className="h-3 w-3 mr-1" /> Nuevo
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">Key (único)</Label>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="my_provider_v1"
              disabled={isEditing}
              className="bg-slate-800 border-slate-600"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Nombre</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mi Proveedor API"
              className="bg-slate-800 border-slate-600"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-slate-300">Descripción</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descripción del conector..."
            className="bg-slate-800 border-slate-600 min-h-[60px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">Capabilities (comma-sep)</Label>
            <Input
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              placeholder="ACTUACIONES, PUBLICACIONES"
              className="bg-slate-800 border-slate-600"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Schema Version</Label>
            <Input
              value={schemaVersion}
              onChange={(e) => setSchemaVersion(e.target.value)}
              className="bg-slate-800 border-slate-600"
            />
          </div>
        </div>

        {/* Allowed Domains */}
        <div className="space-y-2">
          <Label className="text-slate-300 flex items-center gap-2">
            Dominios Permitidos (SSRF allowlist)
            {domainsEmpty && (
              <Badge variant="destructive" className="text-xs">Requerido</Badge>
            )}
            {hasWildcard && !domainsEmpty && (
              <Badge variant="outline" className="text-amber-400 border-amber-500/50 bg-amber-500/10 text-xs">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Wildcard detectado
              </Badge>
            )}
          </Label>
          {allowedDomains.map((domain, idx) => (
            <div key={idx} className="flex gap-2">
              <Input
                value={domain}
                onChange={(e) => updateDomain(idx, e.target.value)}
                placeholder="my-api.example.com"
                className="bg-slate-800 border-slate-600"
              />
              {allowedDomains.length > 1 && (
                <Button size="icon" variant="ghost" onClick={() => removeDomain(idx)}>
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              )}
            </div>
          ))}
          <Button size="sm" variant="outline" className="border-slate-600" onClick={addDomain}>
            <Plus className="h-3 w-3 mr-1" /> Agregar dominio
          </Button>
          {hasWildcard && (
            <p className="text-xs text-amber-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Los wildcards (e.g. *.run.app) amplían la superficie SSRF. Prefiera hostnames exactos en producción.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
            <Label className="text-slate-300">Habilitado</Label>
          </div>
          <div className="flex gap-2">
            {isEditing && (
              <Button
                onClick={() => updateMutation.mutate()}
                disabled={saving || domainsEmpty || !name.trim()}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Actualizar
              </Button>
            )}
            {!isEditing && (
              <Button
                onClick={() => createMutation.mutate()}
                disabled={saving || domainsEmpty || !key.trim() || !name.trim()}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Crear Conector
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
