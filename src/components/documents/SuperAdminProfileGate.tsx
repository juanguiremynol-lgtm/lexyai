/**
 * SuperAdminProfileGate — Modal shown to Super Admin users who are missing
 * required profile fields for the Document Generator.
 * 
 * Normal users go through onboarding; Super Admins may have skipped it.
 * This modal collects the same fields, saves to the same `profiles` table,
 * and logs an audit event.
 */

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/** The fields the Document Generator gate requires */
export interface DocGenRequiredFields {
  firma_abogado_nombre_completo: string;
  firma_abogado_cc: string;
  firma_abogado_tp: string;
  litigation_email: string;
  professional_address?: string;
}

/** Check which required fields are missing from a profile record */
export function getMissingDocGenFields(profile: Record<string, any> | null): string[] {
  if (!profile) return ["firma_abogado_nombre_completo", "firma_abogado_cc", "firma_abogado_tp", "litigation_email"];
  const required: (keyof DocGenRequiredFields)[] = [
    "firma_abogado_nombre_completo",
    "firma_abogado_cc",
    "firma_abogado_tp",
    "litigation_email",
  ];
  return required.filter(k => !profile[k]?.toString().trim());
}

interface SuperAdminProfileGateProps {
  open: boolean;
  onComplete: () => void;
  onCancel: () => void;
  missingFields: string[];
  currentProfile: Record<string, any> | null;
}

const FIELD_LABELS: Record<string, string> = {
  firma_abogado_nombre_completo: "Nombre completo del abogado",
  firma_abogado_cc: "Cédula de ciudadanía",
  firma_abogado_tp: "Tarjeta profesional (T.P.)",
  litigation_email: "Email profesional de litigio",
  professional_address: "Dirección profesional",
};

const FIELD_PLACEHOLDERS: Record<string, string> = {
  firma_abogado_nombre_completo: "Dr. Juan Pérez García",
  firma_abogado_cc: "1.234.567.890",
  firma_abogado_tp: "123.456",
  litigation_email: "abogado@ejemplo.com",
  professional_address: "Calle 100 #10-50, Bogotá",
};

export function SuperAdminProfileGate({ open, onComplete, onCancel, missingFields, currentProfile }: SuperAdminProfileGateProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Pre-fill with existing values
  useEffect(() => {
    if (currentProfile) {
      const initial: Record<string, string> = {};
      for (const field of Object.keys(FIELD_LABELS)) {
        initial[field] = currentProfile[field]?.toString() || "";
      }
      setValues(initial);
    }
  }, [currentProfile]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    const required: string[] = ["firma_abogado_nombre_completo", "firma_abogado_cc", "firma_abogado_tp", "litigation_email"];

    for (const field of required) {
      const val = values[field]?.trim();
      if (!val) {
        newErrors[field] = "Campo requerido";
      }
    }

    // Email validation
    const email = values.litigation_email?.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.litigation_email = "Email inválido";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user session");

      const updatePayload: Record<string, string | null> = {};
      for (const field of Object.keys(FIELD_LABELS)) {
        const val = values[field]?.trim();
        if (val) updatePayload[field] = val;
      }

      const { error } = await supabase
        .from("profiles")
        .update(updatePayload)
        .eq("id", user.id);

      if (error) throw error;

      // Audit log
      const changedFields = missingFields.filter(f => updatePayload[f]);
      console.log("[SuperAdminProfileGate] Profile updated by Super Admin:", {
        userId: user.id,
        fieldsUpdated: changedFields,
        timestamp: new Date().toISOString(),
      });

      toast.success("Perfil actualizado correctamente");
      onComplete();
    } catch (err) {
      console.error("[SuperAdminProfileGate] Save error:", err);
      toast.error("Error al guardar: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Show all fields (required + optional), highlighting missing ones
  const allFields = ["firma_abogado_nombre_completo", "firma_abogado_cc", "firma_abogado_tp", "litigation_email", "professional_address"];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Completar perfil para Generador de Documentos
          </DialogTitle>
          <DialogDescription>
            Tu cuenta de Super Admin no completó el onboarding estándar. Proporciona los datos requeridos para poder generar documentos legales.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {allFields.map((field) => {
            const isMissing = missingFields.includes(field);
            return (
              <div key={field} className="space-y-1">
                <Label className="text-sm flex items-center gap-1">
                  {FIELD_LABELS[field]}
                  {isMissing && <AlertCircle className="h-3 w-3 text-destructive" />}
                </Label>
                <Input
                  value={values[field] || ""}
                  onChange={(e) => {
                    setValues(prev => ({ ...prev, [field]: e.target.value }));
                    if (errors[field]) setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
                  }}
                  placeholder={FIELD_PLACEHOLDERS[field]}
                  className={errors[field] ? "border-destructive" : ""}
                />
                {errors[field] && (
                  <p className="text-xs text-destructive">{errors[field]}</p>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar y continuar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
