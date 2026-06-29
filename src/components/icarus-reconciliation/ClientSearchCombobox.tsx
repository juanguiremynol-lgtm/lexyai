// Debounced search over clients in the current user's organization.
// Used by ClientAssignmentPicker. Returns { id, name } on selection, or null
// when the user wants to create a new client with the given name.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ClientSearchValue {
  /** Existing client id when an existing client is picked. */
  clientId?: string;
  /** Free-text name when the user types one (used to create a client on import). */
  createName?: string;
}

interface Props {
  value: ClientSearchValue;
  onChange: (v: ClientSearchValue) => void;
  placeholder?: string;
  initialSearch?: string;
}

export function ClientSearchCombobox({ value, onChange, placeholder, initialSearch }: Props) {
  const [search, setSearch] = useState(initialSearch ?? value.createName ?? "");
  const [debounced, setDebounced] = useState(search);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["client-search", debounced],
    enabled: debounced.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .ilike("name", `%${debounced.trim()}%`)
        .is("deleted_at", null)
        .order("name")
        .limit(8);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const exactMatch = useMemo(
    () => results.find((r) => r.name.toLowerCase() === debounced.trim().toLowerCase()),
    [results, debounced],
  );

  const selectedLabel = useMemo(() => {
    if (value.clientId) {
      const r = results.find((x) => x.id === value.clientId);
      return r?.name ?? "(cliente seleccionado)";
    }
    if (value.createName) return `Crear nuevo: "${value.createName}"`;
    return "";
  }, [value, results]);

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
            onChange({ createName: e.target.value });
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? "Buscar cliente por nombre…"}
          className="pl-9"
        />
      </div>
      {selectedLabel && !open && (
        <p className="mt-1 text-xs text-muted-foreground">Selección: {selectedLabel}</p>
      )}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-elevated max-h-72 overflow-auto">
          {debounced.trim().length < 2 ? (
            <p className="p-3 text-sm text-muted-foreground">Escribe al menos 2 caracteres…</p>
          ) : (
            <>
              {isFetching && <p className="p-2 text-xs text-muted-foreground">Buscando…</p>}
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2",
                    value.clientId === r.id && "bg-muted",
                  )}
                  onClick={() => {
                    onChange({ clientId: r.id });
                    setSearch(r.name);
                    setOpen(false);
                  }}
                >
                  {value.clientId === r.id ? (
                    <Check className="h-4 w-4 text-primary" />
                  ) : (
                    <span className="w-4" />
                  )}
                  {r.name}
                </button>
              ))}
              {!exactMatch && debounced.trim().length >= 2 && (
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-primary/10 text-primary border-t border-border flex items-center gap-2"
                  onClick={() => {
                    onChange({ createName: debounced.trim() });
                    setOpen(false);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Crear nuevo cliente: "{debounced.trim()}"
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}