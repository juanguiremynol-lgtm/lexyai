import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReconciledItem } from "@/lib/icarus-reconciliation/types";

interface Props {
  items: ReconciledItem[];
}

export function YaExistenSection({ items }: Props) {
  return (
    <Card>
      <Collapsible>
        <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-muted/40 transition-colors group">
          <span className="font-semibold text-sm">Ya existen en Andromeda ({items.length})</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <ul className="divide-y divide-border text-sm">
              {items.map((it) => (
                <li key={it.radicado} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs truncate">{it.radicado}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {it.demandantes[0]} vs. {it.demandados[0]}
                    </p>
                  </div>
                  <Badge variant="outline">{it.existing_workflow_type}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}