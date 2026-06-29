import { Card, CardContent } from "@/components/ui/card";

interface Props {
  total: number;
  faltantes: number;
  divergentes: number;
  yaExisten: number;
}

export function ReconciliationSummary({ total, faltantes, divergentes, yaExisten }: Props) {
  const cells = [
    { label: "Total ICARUS", value: total, tone: "text-foreground" },
    { label: "Faltantes", value: faltantes, tone: "text-amber-600" },
    { label: "Divergentes", value: divergentes, tone: "text-red-600" },
    { label: "Ya existen", value: yaExisten, tone: "text-green-600" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cells.map((c) => (
        <Card key={c.label}>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{c.label}</p>
            <p className={`text-2xl font-semibold ${c.tone}`}>{c.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}