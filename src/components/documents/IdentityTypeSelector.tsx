/**
 * IdentityTypeSelector — Toggles between CC (Cédula) and NIT for party identification.
 */

import { Label } from "@/components/ui/label";
import { User, Building2 } from "lucide-react";
import type { IdType } from "@/hooks/use-document-configuration";

interface IdentityTypeSelectorProps {
  value: IdType;
  onChange: (type: IdType) => void;
  label: string;
  disabled?: boolean;
}

export function IdentityTypeSelector({ value, onChange, label, disabled }: IdentityTypeSelectorProps) {
  const options: { type: IdType; icon: React.ReactNode; title: string; desc: string }[] = [
    { type: "CC", icon: <User className="h-4 w-4" />, title: "Persona natural", desc: "Cédula de ciudadanía" },
    { type: "NIT", icon: <Building2 className="h-4 w-4" />, title: "Persona jurídica", desc: "NIT" },
  ];

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => (
          <button
            key={o.type}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.type)}
            className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all text-left text-xs ${
              value === o.type
                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                : "border-border hover:border-primary/40 hover:bg-muted/30"
            } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <span className={value === o.type ? "text-primary" : "text-muted-foreground"}>{o.icon}</span>
            <div>
              <span className="font-medium block">{o.title}</span>
              <span className="text-muted-foreground">{o.desc}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Returns the display label for an ID type */
export function getIdTypeLabel(idType: IdType): string {
  return idType === "NIT" ? "NIT" : "C.C.";
}

/** Returns the placeholder for an ID type input */
export function getIdTypePlaceholder(idType: IdType): string {
  return idType === "NIT" ? "901.123.456-7" : "1.234.567.890";
}
