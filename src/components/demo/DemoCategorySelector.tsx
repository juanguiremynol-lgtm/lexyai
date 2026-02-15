/**
 * DemoCategorySelector — Pipeline category preview selector (demo-only).
 * 
 * Allows prospects to switch which pipeline template they preview,
 * without changing the underlying inference data.
 */

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import type { DemoCategory } from "./demo-pipeline-stages";
import { getCategoryDisplayName } from "./demo-pipeline-stages";

const SELECTABLE_CATEGORIES: { value: DemoCategory; emoji: string }[] = [
  { value: "CGP", emoji: "⚖️" },
  { value: "CPACA", emoji: "🏛️" },
  { value: "TUTELA", emoji: "🛡️" },
  { value: "PENAL_906", emoji: "🔒" },
];

interface Props {
  inferredCategory: DemoCategory;
  selectedCategory: DemoCategory;
  onCategoryChange: (category: DemoCategory) => void;
  hint?: string | null;
}

export function DemoCategorySelector({
  inferredCategory,
  selectedCategory,
  onCategoryChange,
  hint,
}: Props) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">
          {hint || "Previsualizar pipeline como"}
        </span>
      </div>

      <RadioGroup
        value={selectedCategory}
        onValueChange={(v) => onCategoryChange(v as DemoCategory)}
        className="flex flex-wrap gap-3"
      >
        {SELECTABLE_CATEGORIES.map(({ value, emoji }) => (
          <div key={value} className="flex items-center gap-2">
            <RadioGroupItem value={value} id={`demo-cat-${value}`} />
            <Label
              htmlFor={`demo-cat-${value}`}
              className="text-sm cursor-pointer flex items-center gap-1.5"
            >
              <span>{emoji}</span>
              <span>{getCategoryDisplayName(value)}</span>
              {value === inferredCategory && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 ml-1">
                  Auto-detectado
                </Badge>
              )}
            </Label>
          </div>
        ))}
      </RadioGroup>

      {selectedCategory !== inferredCategory && (
        <p className="text-xs text-muted-foreground">
          Estás previsualizando el pipeline de{" "}
          <strong>{getCategoryDisplayName(selectedCategory)}</strong>.
          Los datos del proceso no cambian — solo la plantilla del pipeline.
        </p>
      )}
    </div>
  );
}
