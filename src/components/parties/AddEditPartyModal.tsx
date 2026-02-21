/**
 * AddEditPartyModal — Modal for creating/editing a work item party
 * Supports natural persons and legal entities (persona jurídica)
 */

import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { User, Building2, AlertCircle, Info } from "lucide-react";
import type { PartyFormData, PartyType, PartySide, WorkItemParty } from "@/lib/party-utils";

interface AddEditPartyModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: PartyFormData) => void;
  party?: WorkItemParty | null;
  side: PartySide;
  sideLabel: string;
  saving?: boolean;
}

export function AddEditPartyModal({ open, onClose, onSave, party, side, sideLabel, saving }: AddEditPartyModalProps) {
  const isEdit = !!party;
  const [partyType, setPartyType] = useState<PartyType>("natural");
  const [isOurClient, setIsOurClient] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (party) {
      setPartyType(party.party_type);
      setIsOurClient(party.is_our_client);
      setForm({
        name: party.name || "",
        cedula: party.cedula || "",
        cedula_city: party.cedula_city || "",
        email: party.email || "",
        phone: party.phone || "",
        address: party.address || "",
        company_name: party.company_name || "",
        company_nit: party.company_nit || "",
        company_city: party.company_city || "",
        rep_legal_name: party.rep_legal_name || "",
        rep_legal_cedula: party.rep_legal_cedula || "",
        rep_legal_cedula_city: party.rep_legal_cedula_city || "",
        rep_legal_cargo: party.rep_legal_cargo || "Representante Legal",
        rep_legal_email: party.rep_legal_email || "",
        rep_legal_phone: party.rep_legal_phone || "",
      });
    } else {
      setPartyType("natural");
      setIsOurClient(side === "demandante");
      setForm({ rep_legal_cargo: "Representante Legal" });
    }
  }, [party, open, side]);

  const update = (field: string, value: string) => setForm((p) => ({ ...p, [field]: value }));

  const canSave = partyType === "natural"
    ? !!form.name?.trim()
    : !!(form.company_name?.trim() || form.name?.trim());

  const handleSave = () => {
    const name = partyType === "juridica" ? (form.company_name || form.name || "") : (form.name || "");
    onSave({
      party_type: partyType,
      party_side: side,
      is_our_client: isOurClient,
      name,
      cedula: form.cedula || undefined,
      cedula_city: form.cedula_city || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      company_name: partyType === "juridica" ? (form.company_name || undefined) : undefined,
      company_nit: partyType === "juridica" ? (form.company_nit || undefined) : undefined,
      company_city: partyType === "juridica" ? (form.company_city || undefined) : undefined,
      rep_legal_name: partyType === "juridica" ? (form.rep_legal_name || undefined) : undefined,
      rep_legal_cedula: partyType === "juridica" ? (form.rep_legal_cedula || undefined) : undefined,
      rep_legal_cedula_city: partyType === "juridica" ? (form.rep_legal_cedula_city || undefined) : undefined,
      rep_legal_cargo: partyType === "juridica" ? (form.rep_legal_cargo || undefined) : undefined,
      rep_legal_email: partyType === "juridica" ? (form.rep_legal_email || undefined) : undefined,
      rep_legal_phone: partyType === "juridica" ? (form.rep_legal_phone || undefined) : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar" : "Agregar"} {sideLabel.toLowerCase()}</DialogTitle>
          <DialogDescription>Complete la información de la parte procesal.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Type selector */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Tipo de parte</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPartyType("natural")}
                className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all text-left ${
                  partyType === "natural"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <User className={`h-5 w-5 ${partyType === "natural" ? "text-primary" : "text-muted-foreground"}`} />
                <div>
                  <div className="font-medium text-sm">Persona natural</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setPartyType("juridica")}
                className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all text-left ${
                  partyType === "juridica"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <Building2 className={`h-5 w-5 ${partyType === "juridica" ? "text-primary" : "text-muted-foreground"}`} />
                <div>
                  <div className="font-medium text-sm">Sociedad / Empresa</div>
                </div>
              </button>
            </div>
          </div>

          {/* Is our client */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="is_our_client"
              checked={isOurClient}
              onCheckedChange={(c) => setIsOurClient(!!c)}
            />
            <label htmlFor="is_our_client" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Es nuestro cliente (a quien representamos)
            </label>
          </div>

          <Separator />

          {partyType === "natural" ? (
            <>
              {/* Natural person fields */}
              <div className="space-y-3">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Datos de identificación</Label>
                <div className="space-y-1">
                  <Label className="text-xs">Nombre completo *</Label>
                  <Input value={form.name || ""} onChange={(e) => update("name", e.target.value)} placeholder="Nombre completo" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Cédula de ciudadanía</Label>
                  <Input value={form.cedula || ""} onChange={(e) => update("cedula", e.target.value)} placeholder="1.234.567.890" />
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Datos de contacto</Label>
                <div className="space-y-1">
                  <Label className="text-xs">Email</Label>
                  <Input type="email" value={form.email || ""} onChange={(e) => update("email", e.target.value)} placeholder="correo@email.com" />
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Info className="h-3 w-3" /> Necesario para enviar documentos de firma
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Dirección</Label>
                  <Input value={form.address || ""} onChange={(e) => update("address", e.target.value)} placeholder="Calle 10 #20-30" />
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Legal entity fields */}
              <div className="space-y-3">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Datos de la empresa</Label>
                <div className="space-y-1">
                  <Label className="text-xs">Razón social *</Label>
                  <Input value={form.company_name || ""} onChange={(e) => update("company_name", e.target.value)} placeholder="Constructora ABC S.A.S." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">NIT</Label>
                    <Input value={form.company_nit || ""} onChange={(e) => update("company_nit", e.target.value)} placeholder="900.123.456-7" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Domicilio principal</Label>
                    <Input value={form.company_city || ""} onChange={(e) => update("company_city", e.target.value)} placeholder="Medellín, Antioquia" />
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Representante legal</Label>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="h-3 w-3" /> Necesario para generar poderes y contratos
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Nombre completo</Label>
                    <Input value={form.rep_legal_name || ""} onChange={(e) => update("rep_legal_name", e.target.value)} placeholder="Nombre completo" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Cédula</Label>
                    <Input value={form.rep_legal_cedula || ""} onChange={(e) => update("rep_legal_cedula", e.target.value)} placeholder="1.111.222.333" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Cargo</Label>
                    <Input value={form.rep_legal_cargo || ""} onChange={(e) => update("rep_legal_cargo", e.target.value)} placeholder="Gerente General" />
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contacto del representante</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Email</Label>
                    <Input type="email" value={form.rep_legal_email || ""} onChange={(e) => update("rep_legal_email", e.target.value)} placeholder="correo@empresa.com" />
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Info className="h-3 w-3" /> Necesario para enviar documentos de firma
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Teléfono</Label>
                    <Input value={form.rep_legal_phone || ""} onChange={(e) => update("rep_legal_phone", e.target.value)} placeholder="604 123 4567" />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? "Guardando..." : "Guardar parte"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
