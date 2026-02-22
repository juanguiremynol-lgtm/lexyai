/**
 * HearingSearchDialog — Full-text search across hearing notes, decisions, key moments, artifact text
 */
import { useState, useMemo } from "react";
import { useWorkItemHearingsV2 } from "@/hooks/use-work-item-hearings-v2";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, FileText, Bookmark, Paperclip } from "lucide-react";
import { HEARING_STATUS_LABELS } from "@/hooks/use-work-item-hearings-v2";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workItemId: string;
  onSelectHearing: (hearingId: string) => void;
}

interface SearchResult {
  hearingId: string;
  hearingName: string;
  hearingDate: string | null;
  status: string;
  source: "notes" | "decisions" | "key_moment" | "artifact";
  snippet: string;
}

function highlightMatch(text: string, query: string, maxLen = 120): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, maxLen);
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 80);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

export function HearingSearchDialog({ open, onOpenChange, workItemId, onSelectHearing }: Props) {
  const [query, setQuery] = useState("");
  const { data: hearings = [] } = useWorkItemHearingsV2(workItemId);

  // Fetch artifact text for search
  const { data: artifacts = [] } = useQuery({
    queryKey: ["hearing-artifacts-search", workItemId],
    queryFn: async () => {
      const hearingIds = hearings.map(h => h.id);
      if (hearingIds.length === 0) return [];
      const { data, error } = await supabase
        .from("hearing_artifacts")
        .select("id, work_item_hearing_id, title, extracted_text, kind")
        .in("work_item_hearing_id", hearingIds);
      if (error) throw error;
      return data || [];
    },
    enabled: open && hearings.length > 0,
  });

  const results = useMemo<SearchResult[]>(() => {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    const matches: SearchResult[] = [];

    for (const h of hearings) {
      const name = h.custom_name || h.hearing_type?.short_name || "Audiencia";
      const date = h.occurred_at || h.scheduled_at;

      // Notes
      if (h.notes_plain_text?.toLowerCase().includes(q)) {
        matches.push({
          hearingId: h.id, hearingName: name, hearingDate: date, status: h.status,
          source: "notes", snippet: highlightMatch(h.notes_plain_text, query),
        });
      }

      // Decisions
      if (h.decisions_summary?.toLowerCase().includes(q)) {
        matches.push({
          hearingId: h.id, hearingName: name, hearingDate: date, status: h.status,
          source: "decisions", snippet: highlightMatch(h.decisions_summary, query),
        });
      }

      // Key moments
      for (const km of (h.key_moments || [])) {
        if (km.text?.toLowerCase().includes(q)) {
          matches.push({
            hearingId: h.id, hearingName: name, hearingDate: date, status: h.status,
            source: "key_moment", snippet: highlightMatch(km.text, query),
          });
          break; // one match per hearing per source
        }
      }
    }

    // Artifact text
    for (const a of artifacts) {
      if (a.extracted_text?.toLowerCase().includes(q) || a.title?.toLowerCase().includes(q)) {
        const h = hearings.find(h => h.id === a.work_item_hearing_id);
        if (h) {
          matches.push({
            hearingId: h.id,
            hearingName: h.custom_name || h.hearing_type?.short_name || "Audiencia",
            hearingDate: h.occurred_at || h.scheduled_at,
            status: h.status,
            source: "artifact",
            snippet: highlightMatch(a.extracted_text || a.title || "", query),
          });
        }
      }
    }

    return matches;
  }, [query, hearings, artifacts]);

  const sourceIcons = {
    notes: <FileText className="h-3.5 w-3.5" />,
    decisions: <FileText className="h-3.5 w-3.5" />,
    key_moment: <Bookmark className="h-3.5 w-3.5" />,
    artifact: <Paperclip className="h-3.5 w-3.5" />,
  };
  const sourceLabels = {
    notes: "Notas",
    decisions: "Decisiones",
    key_moment: "Momento clave",
    artifact: "Archivo",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Buscar en audiencias
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar en notas, decisiones, momentos clave, archivos..."
              className="pl-9"
              autoFocus
            />
          </div>

          <ScrollArea className="max-h-[400px]">
            {query.length < 2 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Escribe al menos 2 caracteres para buscar
              </p>
            ) : results.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Sin resultados para "{query}"
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground mb-2">{results.length} resultado(s)</p>
                {results.map((r, i) => (
                  <button
                    key={`${r.hearingId}-${r.source}-${i}`}
                    onClick={() => { onSelectHearing(r.hearingId); onOpenChange(false); }}
                    className="w-full text-left p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{r.hearingName}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {HEARING_STATUS_LABELS[r.status]}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] gap-1">
                        {sourceIcons[r.source]} {sourceLabels[r.source]}
                      </Badge>
                      {r.hearingDate && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          {format(new Date(r.hearingDate), "d MMM yyyy", { locale: es })}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{r.snippet}</p>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
