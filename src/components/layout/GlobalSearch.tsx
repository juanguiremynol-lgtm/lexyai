import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Search, 
  FileText, 
  Users, 
  Calendar, 
  Gavel,
  FileCheck,
  Scale,
  Building2,
  Loader2,
  X,
  CornerDownLeft
} from "lucide-react";
import { cn } from "@/lib/utils";

// Result types
interface SearchResult {
  id: string;
  type: "work_item" | "client" | "actuacion";
  title: string;
  subtitle: string;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "outline" | "destructive";
  route: string;
}

interface GroupedResults {
  work_items: SearchResult[];
  clients: SearchResult[];
  actuaciones: SearchResult[];
}

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Search function
async function performSearch(query: string): Promise<GroupedResults> {
  if (!query || query.length < 2) {
    return { work_items: [], clients: [], actuaciones: [] };
  }

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return { work_items: [], clients: [], actuaciones: [] };
  }

  const searchPattern = `%${query}%`;
  const limitPerType = 7;

  // Parallel searches
  const [workItemsResult, clientsResult, actuacionesResult] = await Promise.all([
    // Work items search
    supabase
      .from("work_items")
      .select("id, workflow_type, stage, radicado, title, demandantes, demandados, authority_name")
      .or(`radicado.ilike.${searchPattern},title.ilike.${searchPattern},demandantes.ilike.${searchPattern},demandados.ilike.${searchPattern},authority_name.ilike.${searchPattern}`)
      .eq("owner_id", user.user.id)
      .limit(limitPerType),

    // Clients search
    supabase
      .from("clients")
      .select("id, name, id_number, city, email")
      .or(`name.ilike.${searchPattern},id_number.ilike.${searchPattern},city.ilike.${searchPattern},email.ilike.${searchPattern}`)
      .eq("owner_id", user.user.id)
      .limit(limitPerType),

    // Actuaciones search
    supabase
      .from("actuaciones")
      .select("id, work_item_id, act_type_guess, normalized_text, act_date")
      .or(`normalized_text.ilike.${searchPattern},act_type_guess.ilike.${searchPattern}`)
      .eq("owner_id", user.user.id)
      .order("act_date", { ascending: false })
      .limit(limitPerType),
  ]);

  // Transform work items
  const workItems: SearchResult[] = (workItemsResult.data || []).map((item) => ({
    id: item.id,
    type: "work_item" as const,
    title: item.radicado || item.title || "Sin radicado",
    subtitle: [item.demandantes, item.demandados].filter(Boolean).join(" vs ") || item.authority_name || "Sin partes",
    badge: item.workflow_type,
    badgeVariant: "secondary" as const,
    route: `/app/work-items/${item.id}`,
  }));

  // Transform clients
  const clients: SearchResult[] = (clientsResult.data || []).map((client) => ({
    id: client.id,
    type: "client" as const,
    title: client.name,
    subtitle: [client.id_number, client.city, client.email].filter(Boolean).join(" • "),
    badge: "Cliente",
    badgeVariant: "outline" as const,
    route: `/app/clients/${client.id}`,
  }));

  // Transform actuaciones
  const actuaciones: SearchResult[] = (actuacionesResult.data || []).map((act) => ({
    id: act.id,
    type: "actuacion" as const,
    title: act.act_type_guess || "Actuación",
    subtitle: act.normalized_text?.substring(0, 60) + (act.normalized_text && act.normalized_text.length > 60 ? "..." : "") || "Sin descripción",
    badge: act.act_type_guess || "Actuación",
    badgeVariant: "default" as const,
    route: act.work_item_id ? `/app/work-items/${act.work_item_id}` : `/app/work-items`,
  }));

  return {
    work_items: workItems,
    clients: clients,
    actuaciones: actuaciones,
  };
}

// Icon mapping
const TYPE_ICONS: Record<string, React.ReactNode> = {
  CGP: <Scale className="h-4 w-4" />,
  TUTELA: <Gavel className="h-4 w-4" />,
  PETICION: <FileCheck className="h-4 w-4" />,
  CPACA: <Building2 className="h-4 w-4" />,
  GOV_PROCEDURE: <Building2 className="h-4 w-4" />,
  work_item: <FileText className="h-4 w-4" />,
  client: <Users className="h-4 w-4" />,
  actuacion: <Calendar className="h-4 w-4" />,
};

export function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(query, 300);

  // Search query
  const { data: results, isLoading } = useQuery({
    queryKey: ["global-search", debouncedQuery],
    queryFn: () => performSearch(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30000,
  });

  // Flatten results for keyboard navigation
  const flatResults = useMemo(() => {
    if (!results) return [];
    return [
      ...results.work_items,
      ...results.clients,
      ...results.actuaciones,
    ];
  }, [results]);

  const totalResults = flatResults.length;
  const hasResults = totalResults > 0;

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [flatResults]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || !hasResults) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % totalResults);
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + totalResults) % totalResults);
        break;
      case "Enter":
        e.preventDefault();
        if (flatResults[selectedIndex]) {
          navigate(flatResults[selectedIndex].route);
          setIsOpen(false);
          setQuery("");
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        break;
    }
  }, [isOpen, hasResults, totalResults, flatResults, selectedIndex, navigate]);

  // Handle result click
  const handleResultClick = useCallback((result: SearchResult) => {
    navigate(result.route);
    setIsOpen(false);
    setQuery("");
  }, [navigate]);

  // Clear search
  const handleClear = useCallback(() => {
    setQuery("");
    setIsOpen(false);
    inputRef.current?.focus();
  }, []);

  // Render result group
  const renderGroup = (
    title: string,
    items: SearchResult[],
    icon: React.ReactNode,
    startIndex: number
  ) => {
    if (items.length === 0) return null;

    return (
      <div className="py-2">
        <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          {icon}
          {title}
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
            {items.length}
          </Badge>
        </div>
        <div className="space-y-0.5">
          {items.map((result, idx) => {
            const globalIndex = startIndex + idx;
            const isSelected = globalIndex === selectedIndex;

            return (
              <button
                key={result.id}
                className={cn(
                  "w-full px-3 py-2 flex items-start gap-3 text-left transition-colors",
                  "hover:bg-accent focus:bg-accent focus:outline-none",
                  isSelected && "bg-accent"
                )}
                onClick={() => handleResultClick(result)}
                onMouseEnter={() => setSelectedIndex(globalIndex)}
              >
                <div className="mt-0.5 text-muted-foreground">
                  {TYPE_ICONS[result.badge || result.type] || TYPE_ICONS[result.type]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">
                      {result.title}
                    </span>
                    {result.badge && (
                      <Badge 
                        variant={result.badgeVariant} 
                        className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0"
                      >
                        {result.badge}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {result.subtitle}
                  </p>
                </div>
                {isSelected && (
                  <div className="text-muted-foreground flex items-center gap-1 text-xs">
                    <CornerDownLeft className="h-3 w-3" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="search"
          placeholder="Buscar radicado, cliente, juzgado..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          className="w-64 lg:w-80 pl-9 pr-8 bg-background"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          <ScrollArea className="max-h-[400px]">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Buscando...
              </div>
            ) : !hasResults ? (
              <div className="py-8 text-center text-muted-foreground">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No se encontraron resultados</p>
                <p className="text-xs mt-1">Intenta con otro término de búsqueda</p>
              </div>
            ) : (
              <>
                {renderGroup(
                  "Asuntos",
                  results?.work_items || [],
                  <FileText className="h-3.5 w-3.5" />,
                  0
                )}
                {renderGroup(
                  "Clientes",
                  results?.clients || [],
                  <Users className="h-3.5 w-3.5" />,
                  results?.work_items?.length || 0
                )}
                {renderGroup(
                  "Actuaciones",
                  results?.actuaciones || [],
                  <Calendar className="h-3.5 w-3.5" />,
                  (results?.work_items?.length || 0) + (results?.clients?.length || 0)
                )}
                
                {/* Footer hint */}
                <div className="px-3 py-2 border-t border-border bg-muted/50 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{totalResults} resultado{totalResults !== 1 ? "s" : ""}</span>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 bg-background border rounded text-[10px]">↑↓</kbd>
                      navegar
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 bg-background border rounded text-[10px]">↵</kbd>
                      abrir
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 bg-background border rounded text-[10px]">esc</kbd>
                      cerrar
                    </span>
                  </div>
                </div>
              </>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
