// 4-way picker that builds a ClientAssignment for the import flow.

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ClientSearchCombobox, type ClientSearchValue } from "./ClientSearchCombobox";
import type { BatchItem, ClientAssignment } from "@/lib/icarus-reconciliation/types";

interface Props {
  item: BatchItem;
  value: ClientAssignment;
  onChange: (v: ClientAssignment) => void;
}

export function ClientAssignmentPicker({ item, value, onChange }: Props) {
  const handleSearch = (mode: "demandante" | "demandado" | "otro", v: ClientSearchValue) => {
    onChange({ mode, clientId: v.clientId, createName: v.createName });
  };

  return (
    <RadioGroup
      value={value.mode}
      onValueChange={(mode) => {
        switch (mode) {
          case "demandante":
            onChange({ mode: "demandante", createName: item.demandantes[0] });
            break;
          case "demandado":
            onChange({ mode: "demandado", createName: item.demandados[0] });
            break;
          case "self_curador":
            onChange({ mode: "self_curador" });
            break;
          case "otro":
            onChange({ mode: "otro" });
            break;
        }
      }}
      className="space-y-3"
    >
      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="flex items-start gap-2">
          <RadioGroupItem value="demandante" id={`${item.radicado}-demandante`} className="mt-1" />
          <div className="flex-1 space-y-2">
            <Label htmlFor={`${item.radicado}-demandante`} className="cursor-pointer">
              El demandante es mi cliente
            </Label>
            <p className="text-xs text-muted-foreground">{item.demandantes.join(" · ")}</p>
            {value.mode === "demandante" && (
              <ClientSearchCombobox
                value={{ clientId: value.clientId, createName: value.createName }}
                onChange={(v) => handleSearch("demandante", v)}
                initialSearch={item.demandantes[0]}
              />
            )}
          </div>
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="flex items-start gap-2">
          <RadioGroupItem value="demandado" id={`${item.radicado}-demandado`} className="mt-1" />
          <div className="flex-1 space-y-2">
            <Label htmlFor={`${item.radicado}-demandado`} className="cursor-pointer">
              El demandado es mi cliente
            </Label>
            <p className="text-xs text-muted-foreground">{item.demandados.join(" · ")}</p>
            {value.mode === "demandado" && (
              <ClientSearchCombobox
                value={{ clientId: value.clientId, createName: value.createName }}
                onChange={(v) => handleSearch("demandado", v)}
                initialSearch={item.demandados[0]}
              />
            )}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border p-3">
        <div className="flex items-start gap-2">
          <RadioGroupItem value="self_curador" id={`${item.radicado}-self`} className="mt-1" />
          <Label htmlFor={`${item.radicado}-self`} className="cursor-pointer">
            Yo soy el cliente / actúo como curador ad litem
            <p className="text-xs text-muted-foreground font-normal mt-1">
              Crea un cliente con tu nombre del perfil y lo vincula al proceso.
            </p>
          </Label>
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="flex items-start gap-2">
          <RadioGroupItem value="otro" id={`${item.radicado}-otro`} className="mt-1" />
          <div className="flex-1 space-y-2">
            <Label htmlFor={`${item.radicado}-otro`} className="cursor-pointer">
              Otro cliente
            </Label>
            {value.mode === "otro" && (
              <ClientSearchCombobox
                value={{ clientId: value.clientId, createName: value.createName }}
                onChange={(v) => handleSearch("otro", v)}
                placeholder="Buscar o crear cliente…"
              />
            )}
          </div>
        </div>
      </div>
    </RadioGroup>
  );
}