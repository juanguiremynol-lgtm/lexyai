import { Loader2 } from "lucide-react";
import { ReconciliationSummary } from "@/components/icarus-reconciliation/ReconciliationSummary";
import { DivergentesSection } from "@/components/icarus-reconciliation/DivergentesSection";
import { YaExistenSection } from "@/components/icarus-reconciliation/YaExistenSection";
import { ImportItemCard } from "@/components/icarus-reconciliation/ImportItemCard";
import { useIcarusReconciliation } from "@/hooks/use-icarus-reconciliation";
import { ICARUS_RECONCILIATION_BATCH } from "@/lib/data/icarus-reconciliation-batch";

export default function ImportWorkItemsPage() {
  const { data, isLoading, error } = useIcarusReconciliation();

  return (
    <div className="container mx-auto py-8 space-y-8 max-w-4xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Importar work items (ICARUS)</h1>
        <p className="text-sm text-muted-foreground">
          Reconciliación del batch ICARUS contra Andromeda. Solo platform_admin.
        </p>
      </header>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando reconciliación…
        </div>
      )}

      {error && <p className="text-sm text-red-600">Error: {(error as Error).message}</p>}

      {data && (
        <>
          <ReconciliationSummary
            total={ICARUS_RECONCILIATION_BATCH.length}
            faltantes={data.faltantes.length}
            divergentes={data.divergentes.length}
            yaExisten={data.yaExisten.length}
          />

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Faltantes ({data.faltantes.length})</h2>
            {data.faltantes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay items pendientes de importar.</p>
            ) : (
              <div className="space-y-4">
                {data.faltantes.map((it) => (
                  <ImportItemCard key={it.radicado} item={it} />
                ))}
              </div>
            )}
          </section>

          <DivergentesSection items={data.divergentes} />
          <YaExistenSection items={data.yaExisten} />
        </>
      )}
    </div>
  );
}