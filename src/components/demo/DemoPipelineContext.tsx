/**
 * DemoPipelineContext — In-memory state store for the demo pipeline sandbox.
 * 
 * All mutations (drag/drop, delete, reset) are ephemeral — no DB, no localStorage.
 * Provides the same API shape that UnifiedKanbanBoard expects.
 */

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import type { DemoResult, DemoActuacion, DemoEstado, CategoryInference, ProviderOutcome } from "./demo-types";
import { getInitialStage, getDemoStages, type DemoCategory } from "./demo-pipeline-stages";

// ── Demo Work Item shape (mirrors WorkItemPipelineItem) ──
export interface DemoWorkItem {
  id: string;
  radicado: string;
  radicado_display: string;
  category: DemoCategory;
  stage: string;
  despacho: string | null;
  jurisdiccion: string | null;
  tipo_proceso: string | null;
  demandante: string | null;
  demandado: string | null;
  fecha_radicacion: string | null;
  ultima_actuacion_fecha: string | null;
  total_actuaciones: number;
  total_estados: number;
  actuaciones: DemoActuacion[];
  estados: DemoEstado[];
  category_inference: CategoryInference | null;
  provider_outcomes: ProviderOutcome[];
  isDemo: true;
  isSample?: boolean;
}

interface DemoPipelineState {
  items: DemoWorkItem[];
  selectedItemId: string | null;
  isDetailOpen: boolean;
  /** Presentation-only category override (does not change inference data) */
  categoryOverride: DemoCategory | null;
  // Actions
  moveItem: (itemId: string, newStage: string) => void;
  deleteItem: (itemId: string) => void;
  selectItem: (itemId: string | null) => void;
  openDetail: (itemId: string) => void;
  closeDetail: () => void;
  reset: () => void;
  setCategoryOverride: (category: DemoCategory | null) => void;
}

const DemoPipelineCtx = createContext<DemoPipelineState | null>(null);

export function useDemoPipeline() {
  const ctx = useContext(DemoPipelineCtx);
  if (!ctx) throw new Error("useDemoPipeline must be used within DemoPipelineProvider");
  return ctx;
}

/**
 * Build demo work items from the lookup result
 */
function buildDemoItems(data: DemoResult): DemoWorkItem[] {
  const cat = (data.category_inference?.category || "UNCERTAIN") as DemoCategory;
  const validCategories: DemoCategory[] = ["CGP", "CPACA", "TUTELA", "PENAL_906"];
  const category: DemoCategory = validCategories.includes(cat) ? cat : "UNCERTAIN";
  const initialStage = getInitialStage(category);

  const mainItem: DemoWorkItem = {
    id: `demo-${crypto.randomUUID().slice(0, 8)}`,
    radicado: data.resumen.radicado || data.resumen.radicado_display.replace(/\s/g, ""),
    radicado_display: data.resumen.radicado_display,
    category,
    stage: initialStage,
    despacho: data.resumen.despacho,
    jurisdiccion: data.resumen.jurisdiccion,
    tipo_proceso: data.resumen.tipo_proceso,
    demandante: data.resumen.demandante,
    demandado: data.resumen.demandado,
    fecha_radicacion: data.resumen.fecha_radicacion,
    ultima_actuacion_fecha: data.resumen.ultima_actuacion_fecha,
    total_actuaciones: data.actuaciones.length,
    total_estados: data.estados.length,
    actuaciones: data.actuaciones,
    estados: data.estados,
    category_inference: data.category_inference || null,
    provider_outcomes: data.meta.provider_outcomes || [],
    isDemo: true,
  };

  // Add a sample card for multi-card demonstration
  const sampleItem: DemoWorkItem = {
    id: `demo-sample-${crypto.randomUUID().slice(0, 8)}`,
    radicado: "05001400300220240099900",
    radicado_display: "05 001 40 03 002 2024 00999 00",
    category,
    stage: getDemoStages_next(category, initialStage),
    despacho: "Juzgado 2 Civil Municipal de Medellín",
    jurisdiccion: "Civil",
    tipo_proceso: "Proceso declarativo",
    demandante: "Ejemplo S.A.S.",
    demandado: "Corporación Demo",
    fecha_radicacion: "2024-06-15",
    ultima_actuacion_fecha: "2025-01-20",
    total_actuaciones: 12,
    total_estados: 3,
    actuaciones: [],
    estados: [],
    category_inference: null,
    provider_outcomes: [],
    isDemo: true,
    isSample: true,
  };

  return [mainItem, sampleItem];
}

/** Get the next stage after the initial one */
function getDemoStages_next(category: DemoCategory, currentStage: string): string {
  const stages = getDemoStages(category);
  const idx = stages.findIndex((s) => s.id === currentStage);
  return stages[Math.min(idx + 1, stages.length - 1)]?.id || currentStage;
}

interface ProviderProps {
  data: DemoResult;
  children: ReactNode;
}

export function DemoPipelineProvider({ data, children }: ProviderProps) {
  const initialItems = useMemo(() => buildDemoItems(data), [data]);
  const [items, setItems] = useState<DemoWorkItem[]>(initialItems);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [categoryOverride, setCategoryOverride] = useState<DemoCategory | null>(null);

  const moveItem = useCallback((itemId: string, newStage: string) => {
    setItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, stage: newStage } : item
    ));
  }, []);

  const deleteItem = useCallback((itemId: string) => {
    setItems(prev => prev.filter(item => item.id !== itemId));
    if (selectedItemId === itemId) {
      setSelectedItemId(null);
      setIsDetailOpen(false);
    }
  }, [selectedItemId]);

  const selectItem = useCallback((itemId: string | null) => {
    setSelectedItemId(itemId);
  }, []);

  const openDetail = useCallback((itemId: string) => {
    setSelectedItemId(itemId);
    setIsDetailOpen(true);
  }, []);

  const closeDetail = useCallback(() => {
    setIsDetailOpen(false);
  }, []);

  const reset = useCallback(() => {
    setItems(buildDemoItems(data));
    setSelectedItemId(null);
    setIsDetailOpen(false);
    setCategoryOverride(null);
  }, [data]);

  // When category override changes, re-map items to use new stage config
  const handleCategoryOverride = useCallback((cat: DemoCategory | null) => {
    setCategoryOverride(cat);
    if (cat) {
      setItems(prev => prev.map(item => ({
        ...item,
        category: cat,
        stage: getInitialStage(cat),
      })));
    }
  }, []);

  const value = useMemo<DemoPipelineState>(() => ({
    items,
    selectedItemId,
    isDetailOpen,
    categoryOverride,
    moveItem,
    deleteItem,
    selectItem,
    openDetail,
    closeDetail,
    reset,
    setCategoryOverride: handleCategoryOverride,
  }), [items, selectedItemId, isDetailOpen, categoryOverride, moveItem, deleteItem, selectItem, openDetail, closeDetail, reset, handleCategoryOverride]);

  return (
    <DemoPipelineCtx.Provider value={value}>
      {children}
    </DemoPipelineCtx.Provider>
  );
}
