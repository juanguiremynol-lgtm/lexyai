/**
 * DocumentBrandingSettings — Logo upload, firm name, and branding preview.
 */

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Upload, Save, RotateCcw, Loader2, Lock, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useOrganizationMembership } from "@/hooks/use-organization-membership";

export function DocumentBrandingSettings() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const { isAdmin } = useOrganizationMembership(organization?.id || null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [firmName, setFirmName] = useState("");
  const [firmNameLoaded, setFirmNameLoaded] = useState(false);

  // Determine if user is editing org or personal branding
  const isOrgContext = !!organization && isAdmin;

  const { data: brandingData, isLoading } = useQuery({
    queryKey: ["branding-settings", organization?.id],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      if (isOrgContext && organization) {
        const { data } = await supabase
          .from("organizations")
          .select("custom_logo_path, custom_firm_name, custom_branding_enabled, name")
          .eq("id", organization.id)
          .single();
        return { ...data, scope: "org" as const };
      } else {
        const { data } = await supabase
          .from("profiles")
          .select("custom_logo_path, custom_firm_name, custom_branding_enabled, full_name")
          .eq("id", user.id)
          .single();
        return { ...data, scope: "user" as const };
      }
    },
  });

  // Initialize firm name from data
  if (brandingData && !firmNameLoaded) {
    setFirmName(brandingData.custom_firm_name || (brandingData as any).name || (brandingData as any).full_name || "");
    setFirmNameLoaded(true);
  }

  const logoUrl = brandingData?.custom_logo_path
    ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/branding/${brandingData.custom_logo_path}`
    : null;

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/png", "image/svg+xml"].includes(file.type)) {
      toast.error("Solo se aceptan archivos PNG o SVG");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("El archivo no puede superar 2MB");
      return;
    }

    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const ext = file.type === "image/svg+xml" ? "svg" : "png";
      const path = isOrgContext && organization
        ? `${organization.id}/logo.${ext}`
        : `${user.id}/logo.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("branding")
        .upload(path, file, { upsert: true, contentType: file.type });

      if (uploadErr) throw uploadErr;

      // Update the record
      if (isOrgContext && organization) {
        await supabase.from("organizations").update({
          custom_logo_path: path,
          custom_branding_enabled: true,
        }).eq("id", organization.id);
      } else {
        await supabase.from("profiles").update({
          custom_logo_path: path,
          custom_branding_enabled: true,
        }).eq("id", user.id);
      }

      queryClient.invalidateQueries({ queryKey: ["branding-settings"] });
      queryClient.invalidateQueries({ queryKey: ["branding-profile"] });
      toast.success("Logo actualizado");
    } catch (err) {
      toast.error("Error: " + (err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const saveFirmName = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      if (isOrgContext && organization) {
        await supabase.from("organizations").update({
          custom_firm_name: firmName,
          custom_branding_enabled: true,
        }).eq("id", organization.id);
      } else {
        await supabase.from("profiles").update({
          custom_firm_name: firmName,
          custom_branding_enabled: true,
        }).eq("id", user.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branding-settings"] });
      queryClient.invalidateQueries({ queryKey: ["branding-profile"] });
      toast.success("Nombre de firma guardado");
    },
    onError: (err) => toast.error("Error: " + (err as Error).message),
  });

  const handleResetBranding = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      if (isOrgContext && organization) {
        await supabase.from("organizations").update({
          custom_logo_path: null,
          custom_firm_name: null,
          custom_branding_enabled: false,
        }).eq("id", organization.id);
      } else {
        await supabase.from("profiles").update({
          custom_logo_path: null,
          custom_firm_name: null,
          custom_branding_enabled: false,
        }).eq("id", user.id);
      }
    },
    onSuccess: () => {
      setFirmName("");
      queryClient.invalidateQueries({ queryKey: ["branding-settings"] });
      queryClient.invalidateQueries({ queryKey: ["branding-profile"] });
      toast.success("Marca restaurada a Andromeda Legal");
    },
    onError: (err) => toast.error("Error: " + (err as Error).message),
  });

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            Marca y Logo
          </CardTitle>
          <CardDescription>
            El logo y la marca que configure aquí aparecerán en la página de firma que ven sus clientes, 
            el certificado de evidencia y los correos electrónicos enviados.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current Logo */}
          <div className="space-y-3">
            <Label>Logo actual</Label>
            <div className="border-2 border-dashed rounded-lg p-6 flex items-center justify-center bg-muted/30 min-h-[120px]">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo de la firma" className="max-h-[80px] max-w-[300px] object-contain" />
              ) : (
                <div className="text-center space-y-1">
                  <p className="font-bold text-xl tracking-tight" style={{ color: "#1a1a2e" }}>ANDROMEDA LEGAL</p>
                  <p className="text-xs text-muted-foreground">Logo predeterminado</p>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.svg"
                onChange={handleLogoUpload}
                className="hidden"
              />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                Subir logo
              </Button>
              <Button
                variant="ghost"
                onClick={() => handleResetBranding.mutate()}
                disabled={handleResetBranding.isPending || !brandingData?.custom_branding_enabled}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Restaurar predeterminado
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Formato: PNG o SVG (fondo transparente recomendado) · Tamaño máximo: 2MB · Dimensiones recomendadas: 300×100px
            </p>
          </div>

          <Separator />

          {/* Firm Name */}
          <div className="space-y-2">
            <Label>Nombre de la firma (aparece debajo del logo)</Label>
            <div className="flex gap-2">
              <Input
                value={firmName}
                onChange={(e) => setFirmName(e.target.value)}
                placeholder="García & Asociados Abogados"
                className="flex-1"
              />
              <Button onClick={() => saveFirmName.mutate()} disabled={saveFirmName.isPending}>
                {saveFirmName.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Guardar
              </Button>
            </div>
          </div>

          <Separator />

          {/* Preview */}
          <div className="space-y-2">
            <Label>Vista previa</Label>
            <div className="border rounded-lg p-6 bg-white">
              <div className="text-center space-y-2">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="max-h-[60px] mx-auto object-contain" />
                ) : (
                  <p className="font-bold text-xl tracking-tight" style={{ color: "#1a1a2e" }}>ANDROMEDA LEGAL</p>
                )}
                <p className="text-sm text-muted-foreground">{firmName || "Plataforma de Gestión Legal"}</p>
                <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  <span className="text-xs">Firma electrónica segura</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
