import { CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReconciledItem } from "@/lib/icarus-reconciliation/types";

interface Props {
  items: ReconciledItem[];
}

export function DivergentesSection({ items }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Divergentes ({items.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            Todos los items existentes están correctamente clasificados.
          </div>
        ) : (
          <ul className="space-y-2 text-sm">
            {items.map((it) => (
              <li key={it.radicado} className="flex justify-between">
                <span className="font-mono text-xs">{it.radicado}</span>
                <span>{it.existing_workflow_type} → {it.suggested_workflow_type}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}