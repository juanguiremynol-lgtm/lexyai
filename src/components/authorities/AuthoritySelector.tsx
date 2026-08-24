/**
 * Fase 5 / A.3 — structured authority selection.
 *
 * The destination of a petición or of an administrative procedure stops being
 * free text and becomes a reference to `authorities`. The free-text name is
 * still stored alongside (and never rewritten), but matching can only promote
 * evidence when the structured reference exists.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface AuthorityOption {
  id: string;
  canonical_name: string;
  authority_kind: string;
  aliases: string[];
}

export interface AuthoritySelectorProps {
  authorityId: string | null;
  /** The free-text name kept for the record; never rewritten by this control. */
  freeTextName: string;
  onChange: (value: { authorityId: string | null; freeTextName: string }) => void;
  label?: string;
  required?: boolean;
}

export function useAuthorities() {
  return useQuery({
    queryKey: ["authorities"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AuthorityOption[]> => {
      const { data, error } = await supabase
        .from("authorities")
        .select("id, canonical_name, authority_kind, aliases")
        .eq("active", true)
        .order("canonical_name");
      if (error) throw error;
      return (data ?? []) as AuthorityOption[];
    },
  });
}

export function AuthoritySelector({
  authorityId,
  freeTextName,
  onChange,
  label = "Autoridad destinataria",
  required,
}: AuthoritySelectorProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const queryClient = useQueryClient();
  const { data: authorities = [], isLoading } = useAuthorities();

  const selected = useMemo(
    () => authorities.find((a) => a.id === authorityId) ?? null,
    [authorities, authorityId],
  );

  const createAuthority = useMutation({
    mutationFn: async (canonicalName: string) => {
      const { data, error } = await supabase
        .from("authorities")
        .insert({ canonical_name: canonicalName, authority_kind: "ENTIDAD_PUBLICA" })
        .select("id, canonical_name, authority_kind, aliases")
        .single();
      if (error) throw error;
      return data as AuthorityOption;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["authorities"] });
      onChange({ authorityId: row.id, freeTextName: row.canonical_name });
      setCreating(false);
      setNewName("");
      setOpen(false);
      toast.success("Autoridad creada sin verificar. Se verificará al confirmar un correo suyo.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required ? " *" : ""}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            {selected?.canonical_name ?? freeTextName ?? "Seleccione una autoridad"}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar autoridad…" />
            <CommandList>
              <CommandEmpty>
                {isLoading ? "Cargando…" : "Sin coincidencias en el registro."}
              </CommandEmpty>
              <CommandGroup>
                {authorities.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`${a.canonical_name} ${a.aliases.join(" ")}`}
                    onSelect={() => {
                      onChange({ authorityId: a.id, freeTextName: a.canonical_name });
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        a.id === authorityId ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {a.canonical_name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          <div className="border-t p-2">
            {creating ? (
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nombre de la autoridad"
                />
                <Button
                  size="sm"
                  disabled={!newName.trim() || createAuthority.isPending}
                  onClick={() => createAuthority.mutate(newName.trim())}
                >
                  Crear
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => setCreating(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Crear autoridad
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {!authorityId && freeTextName ? (
        <p className="text-xs text-muted-foreground">
          Sin autoridad registrada: los correos de esta entidad solo podrán proponerse, nunca
          vincularse automáticamente.
        </p>
      ) : null}
    </div>
  );
}
