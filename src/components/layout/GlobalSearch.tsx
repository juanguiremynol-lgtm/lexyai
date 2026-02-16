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
  CornerDownLeft,
  Clock,
  ArrowRight,
  Bell,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/contexts/OrganizationContext";

// ── Types ──
interface SearchResult {
  id: string;
  type: "work_item" | "client" | "actuacion";
  title: string;
  subtitle: string;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "outline" | "destructive";
  route: string;
  relevance: number;
  isOrgItem?: boolean; // true if admin is viewing another user's item
}

interface GroupedResults {
  work_items: SearchResult[];
  clients: SearchResult[];
  actuaciones: SearchResult[];
}

interface RecentItem {
  id: string;
  type: SearchResult["type"];
  title: string;
  subtitle: string;
  route: string;
  badge?: string;
  timestamp: number;
}

// ── Category shortcuts ──
const CATEGORY_SHORTCUTS = [
  { label: "Todos los asuntos", icon: <FileText className="h-4 w-4" />, route: "/app/work-items" },
  { label: "Clientes", icon: <Users className="h-4 w-4" />, route: "/app/clients" },
  { label: "Alertas", icon: <Bell className="h-4 w-4" />, route: "/app/alerts" },
] as const;

// ── Recent items storage ──
const RECENT_KEY = "andromeda_recent_searches";
const MAX_RECENT = 6;

function getRecentItems(): RecentItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentItem[];
  } catch {
    return [];
  }
}

function saveRecentItem(result: SearchResult) {
  const items = getRecentItems().filter((r) => r.id !== result.id);
  items.unshift({
    id: result.id,
    type: result.type,
    title: result.title,
    subtitle: result.subtitle,
    route: result.route,
    badge: result.badge,
    timestamp: Date.now(),
  });
  localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
}

// ── Debounce hook ──
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

// ── Highlight matching text ──
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 1 || !text) return <>{text}</>;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedQuery})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-primary/20 text-foreground rounded-sm px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ── Radicado normalization (strip non-digits) ──
function normalizeRadicado(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

// ── Enhanced relevance scoring ──
function scoreWorkItemResult(
  item: { radicado: string | null; title: string | null; demandantes: string | null; demandados: string | null; authority_name: string | null },
  query: string
): number {
  const q = query.toLowerCase().trim();
  const qDigits = normalizeRadicado(q);

  // 1. Exact radicado match (highest priority)
  if (item.radicado) {
    const normalizedRad = normalizeRadicado(item.radicado);
    if (normalizedRad === qDigits && qDigits.length > 0) return 1;
    if (normalizedRad.startsWith(qDigits) && qDigits.length > 0) return 2;
    if (item.radicado.toLowerCase().includes(q)) return 3;
  }

  // 2. Title match
  const title = (item.title || "").toLowerCase();
  if (title === q) return 4;
  if (title.startsWith(q)) return 5;
  if (title.includes(q)) return 6;

  // 3. Party name match
  const demandantes = (item.demandantes || "").toLowerCase();
  const demandados = (item.demandados || "").toLowerCase();
  if (demandantes.startsWith(q) || demandados.startsWith(q)) return 7;
  if (demandantes.includes(q) || demandados.includes(q)) return 8;

  // 4. Authority/courthouse match
  const authority = (item.authority_name || "").toLowerCase();
  if (authority.startsWith(q)) return 9;
  if (authority.includes(q)) return 10;

  return 11;
}

function scoreResult(result: { title: string; subtitle: string }, query: string): number {
  const q = query.toLowerCase();
  const title = result.title.toLowerCase();
  if (title === q) return 1;
  if (title.startsWith(q)) return 2;
  if (title.includes(q)) return 3;
  if (result.subtitle.toLowerCase().includes(q)) return 4;
  return 5;
}

// ── Abort-controller-aware search ──
let searchAbortController: AbortController | null = null;

interface SearchContext {
  userId: string;
  organizationId?: string;
  isAdmin: boolean;
}

async function getSearchContext(): Promise<SearchContext | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Get org from profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .maybeSingle();

  const orgId = profile?.organization_id || undefined;

  // Check if admin/owner in org AND on business tier
  let isAdmin = false;
  if (orgId) {
    // Check membership role
    const { data: membership } = await supabase
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", user.id)
      .maybeSingle();

    const hasAdminRole = membership?.role === "OWNER" || membership?.role === "ADMIN";

    if (hasAdminRole) {
      // Defense-in-depth: verify business tier subscription
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("status, plan:subscription_plans!inner(name)")
        .eq("organization_id", orgId)
        .in("status", ["active", "trialing"])
        .maybeSingle();

      const planName = (sub?.plan as any)?.name;
      const hasBusinessTier = planName === "business" || planName === "unlimited";

      // Also check billing_subscription_state
      const { data: billing } = await supabase
        .from("billing_subscription_state")
        .select("plan_code, status")
        .eq("organization_id", orgId)
        .maybeSingle();

      const hasBillingBusiness = billing &&
        ["ACTIVE", "TRIAL"].includes(billing.status || "") &&
        ["BUSINESS", "ENTERPRISE", "UNLIMITED"].includes(billing.plan_code || "");

      isAdmin = hasBusinessTier || !!hasBillingBusiness;
    }
  }

  return { userId: user.id, organizationId: orgId, isAdmin };
}

async function performSearch(query: string, organizationId?: string): Promise<GroupedResults> {
  if (!query || query.length < 1) {
    return { work_items: [], clients: [], actuaciones: [] };
  }

  if (searchAbortController) searchAbortController.abort();
  searchAbortController = new AbortController();

  const ctx = await getSearchContext();
  if (!ctx) return { work_items: [], clients: [], actuaciones: [] };

  const searchPattern = `%${query}%`;
  const limitPerType = 10;

  // Build work items query with permission scoping
  const buildWorkItemsQuery = () => {
    let q = supabase
      .from("work_items")
      .select("id, workflow_type, stage, radicado, title, demandantes, demandados, authority_name, authority_city, owner_id, updated_at")
      .is("deleted_at", null)
      .or(`radicado.ilike.${searchPattern},title.ilike.${searchPattern},demandantes.ilike.${searchPattern},demandados.ilike.${searchPattern},authority_name.ilike.${searchPattern}`)
      .limit(limitPerType)
      .order("updated_at", { ascending: false });

    if (ctx.isAdmin && ctx.organizationId) {
      // Admin: see all org items
      q = q.eq("organization_id", ctx.organizationId);
    } else if (ctx.organizationId) {
      // Normal member: only own items
      q = q.eq("organization_id", ctx.organizationId).eq("owner_id", ctx.userId);
    } else {
      // No org: fallback to owner
      q = q.eq("owner_id", ctx.userId);
    }

    return q;
  };

  const buildClientsQuery = () => {
    let q = supabase
      .from("clients")
      .select("id, name, id_number, city, email, owner_id")
      .is("deleted_at", null)
      .or(`name.ilike.${searchPattern},id_number.ilike.${searchPattern},city.ilike.${searchPattern},email.ilike.${searchPattern}`)
      .limit(limitPerType);

    if (ctx.isAdmin && ctx.organizationId) {
      // Admin: RLS now allows all org clients
      q = q.eq("organization_id", ctx.organizationId);
    } else if (ctx.organizationId) {
      q = q.eq("organization_id", ctx.organizationId).eq("owner_id", ctx.userId);
    } else {
      q = q.eq("owner_id", ctx.userId);
    }

    return q;
  };

  const buildActuacionesQuery = () => {
    let q = supabase
      .from("actuaciones")
      .select("id, work_item_id, act_type_guess, normalized_text, act_date")
      .or(`normalized_text.ilike.${searchPattern},act_type_guess.ilike.${searchPattern}`)
      .order("act_date", { ascending: false })
      .limit(limitPerType);

    if (ctx.isAdmin && ctx.organizationId) {
      q = q.eq("organization_id", ctx.organizationId);
    } else if (ctx.organizationId) {
      q = q.eq("organization_id", ctx.organizationId).eq("owner_id", ctx.userId);
    } else {
      q = q.eq("owner_id", ctx.userId);
    }

    return q;
  };

  const [workItemsResult, clientsResult, actuacionesResult] = await Promise.all([
    buildWorkItemsQuery(),
    buildClientsQuery(),
    buildActuacionesQuery(),
  ]);

  const workItems: SearchResult[] = (workItemsResult.data || []).map((item) => {
    const parties = [item.demandantes, item.demandados].filter(Boolean).join(" vs ");
    const subtitleParts = [parties, item.authority_name, item.authority_city].filter(Boolean);
    const isOrgItem = ctx.isAdmin && item.owner_id !== ctx.userId;

    return {
      id: item.id,
      type: "work_item" as const,
      title: item.radicado || item.title || "Sin radicado",
      subtitle: subtitleParts.join(" · ") || "Sin información",
      badge: item.workflow_type,
      badgeVariant: "secondary" as const,
      route: `/app/work-items/${item.id}`,
      relevance: scoreWorkItemResult(item, query),
      isOrgItem,
    };
  }).sort((a, b) => a.relevance - b.relevance);

  const clients: SearchResult[] = (clientsResult.data || []).map((client) => {
    const isOrgItem = ctx.isAdmin && client.owner_id !== ctx.userId;
    const result: SearchResult = {
      id: client.id,
      type: "client" as const,
      title: client.name,
      subtitle: [client.id_number, client.city, client.email].filter(Boolean).join(" • "),
      badge: "Cliente",
      badgeVariant: "outline" as const,
      route: `/app/clients/${client.id}`,
      relevance: 5,
      isOrgItem,
    };
    result.relevance = scoreResult(result, query);
    return result;
  }).sort((a, b) => a.relevance - b.relevance);

  const actuaciones: SearchResult[] = (actuacionesResult.data || []).map((act) => {
    const snippet = act.normalized_text?.substring(0, 60) + (act.normalized_text && act.normalized_text.length > 60 ? "..." : "") || "Sin descripción";
    const result = {
      id: act.id,
      type: "actuacion" as const,
      title: act.act_type_guess || "Actuación",
      subtitle: snippet,
      badge: act.act_type_guess || "Actuación",
      badgeVariant: "default" as const,
      route: act.work_item_id ? `/app/work-items/${act.work_item_id}` : `/app/work-items`,
      relevance: 5,
    };
    result.relevance = scoreResult(result, query);
    return result;
  }).sort((a, b) => a.relevance - b.relevance);

  return { work_items: workItems, clients, actuaciones };
}

// ── Icon mapping ──
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
  const { organization } = useOrganization();
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);

  const debouncedQuery = useDebounce(query, 200);

  // Load recent items when panel opens
  useEffect(() => {
    if (isOpen) setRecentItems(getRecentItems());
  }, [isOpen]);

  // "/" keyboard shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // Search from 2 characters
  const { data: results, isLoading } = useQuery({
    queryKey: ["global-search", debouncedQuery, organization?.id],
    queryFn: () => performSearch(debouncedQuery, organization?.id),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30000,
  });

  const hasQuery = query.trim().length >= 2;

  // Build navigable items list for keyboard nav
  const navigableItems = useMemo(() => {
    if (hasQuery && results) {
      return [
        ...results.work_items,
        ...results.clients,
        ...results.actuaciones,
      ].map((r) => ({ ...r, kind: "result" as const }));
    }
    const items: Array<{ kind: "recent" | "shortcut"; id: string; route: string; label?: string }> = [];
    recentItems.forEach((r) => items.push({ kind: "recent", id: r.id, route: r.route }));
    CATEGORY_SHORTCUTS.forEach((s, i) => items.push({ kind: "shortcut", id: `shortcut-${i}`, route: s.route, label: s.label }));
    return items;
  }, [hasQuery, results, recentItems]);

  const totalNavigable = navigableItems.length;

  // Reset selected index on list change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [navigableItems.length, hasQuery]);

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

  // Navigate to a route & save recent
  const goTo = useCallback((route: string, result?: SearchResult) => {
    if (result) saveRecentItem(result);
    navigate(route);
    setIsOpen(false);
    setQuery("");
  }, [navigate]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (!isOpen || totalNavigable === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % totalNavigable);
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev <= 0 ? totalNavigable - 1 : prev - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < totalNavigable) {
          const item = navigableItems[selectedIndex];
          if (hasQuery && "type" in item) {
            goTo(item.route, item as unknown as SearchResult);
          } else {
            goTo(item.route);
          }
        }
        break;
    }
  }, [isOpen, totalNavigable, selectedIndex, navigableItems, hasQuery, goTo]);

  // Handle result click
  const handleResultClick = useCallback((result: SearchResult) => {
    goTo(result.route, result);
  }, [goTo]);

  // Clear
  const handleClear = useCallback(() => {
    setQuery("");
    inputRef.current?.focus();
  }, []);

  // Remove a recent item
  const removeRecent = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = getRecentItems().filter((r) => r.id !== id);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    setRecentItems(updated);
  }, []);

  // ── Render helpers ──

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
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{items.length}</Badge>
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
                      <HighlightMatch text={result.title} query={query} />
                    </span>
                    {result.badge && (
                      <Badge variant={result.badgeVariant} className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0">
                        {result.badge}
                      </Badge>
                    )}
                    {result.isOrgItem && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0 text-muted-foreground border-dashed gap-1">
                        <Eye className="h-2.5 w-2.5" />
                        Org
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    <HighlightMatch text={result.subtitle} query={query} />
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

  // Predictions panel (shown when no query)
  const renderPredictions = () => {
    const hasRecent = recentItems.length > 0;
    let navIdx = 0;

    return (
      <>
        {/* Recent Items */}
        {hasRecent && (
          <div className="py-2">
            <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" />
              Recientes
            </div>
            <div className="space-y-0.5">
              {recentItems.map((item) => {
                const idx = navIdx++;
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={item.id}
                    className={cn(
                      "w-full px-3 py-2 flex items-center gap-3 text-left transition-colors group",
                      "hover:bg-accent focus:bg-accent focus:outline-none",
                      isSelected && "bg-accent"
                    )}
                    onClick={() => goTo(item.route)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <div className="text-muted-foreground">
                      {TYPE_ICONS[item.badge || item.type] || TYPE_ICONS[item.type]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">{item.title}</span>
                      <span className="text-xs text-muted-foreground truncate block">{item.subtitle}</span>
                    </div>
                    <button
                      onClick={(e) => removeRecent(item.id, e)}
                      className="opacity-0 group-hover:opacity-70 hover:!opacity-100 text-muted-foreground transition-opacity p-1"
                      aria-label="Eliminar reciente"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    {isSelected && (
                      <div className="text-muted-foreground flex items-center text-xs">
                        <CornerDownLeft className="h-3 w-3" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Category Shortcuts */}
        <div className={cn("py-2", hasRecent && "border-t border-border")}>
          <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <ArrowRight className="h-3.5 w-3.5" />
            Ir a
          </div>
          <div className="space-y-0.5">
            {CATEGORY_SHORTCUTS.map((shortcut, i) => {
              const idx = navIdx++;
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={shortcut.route}
                  className={cn(
                    "w-full px-3 py-2 flex items-center gap-3 text-left transition-colors",
                    "hover:bg-accent focus:bg-accent focus:outline-none",
                    isSelected && "bg-accent"
                  )}
                  onClick={() => goTo(shortcut.route)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="text-muted-foreground">{shortcut.icon}</div>
                  <span className="text-sm">{shortcut.label}</span>
                  {isSelected && (
                    <div className="ml-auto text-muted-foreground flex items-center text-xs">
                      <CornerDownLeft className="h-3 w-3" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </>
    );
  };

  // Determine what to show in dropdown
  const showDropdown = isOpen;

  const flatResults = useMemo(() => {
    if (!results) return [];
    return [...results.work_items, ...results.clients, ...results.actuaciones];
  }, [results]);
  const totalResults = flatResults.length;
  const hasResults = totalResults > 0;

  return (
    <div ref={containerRef} className="relative">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="search"
          placeholder='Buscar radicado, partes, juzgado...  ("/" para enfocar)'
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
        {isLoading && hasQuery && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          <ScrollArea className="max-h-[420px]">
            {hasQuery ? (
              // ── Live search results ──
              isLoading ? (
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
                  {renderGroup("Asuntos", results?.work_items || [], <FileText className="h-3.5 w-3.5" />, 0)}
                  {renderGroup("Clientes", results?.clients || [], <Users className="h-3.5 w-3.5" />, results?.work_items?.length || 0)}
                  {renderGroup("Actuaciones", results?.actuaciones || [], <Calendar className="h-3.5 w-3.5" />, (results?.work_items?.length || 0) + (results?.clients?.length || 0))}
                </>
              )
            ) : (
              // ── Predictions panel ──
              renderPredictions()
            )}
          </ScrollArea>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-border bg-muted/50 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {hasQuery && hasResults
                ? `${totalResults} resultado${totalResults !== 1 ? "s" : ""}`
                : hasQuery
                  ? ""
                  : "Busca o selecciona"}
            </span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-background border rounded text-[10px]">/</kbd>
                buscar
              </span>
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
        </div>
      )}
    </div>
  );
}
