import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export interface PipelineItem {
  id: string;
  type: "filing" | "process" | "tutela" | "peticion" | "admin" | "cpaca";
  radicado?: string | null;
}

type StageType = "filing" | "process" | "tutela" | "peticion" | "admin" | "cpaca";

interface UsePipelineKeyboardProps {
  stages: { id: string; type: StageType }[];
  itemsByStage: Record<string, PipelineItem[]>;
  onReclassify: (item: PipelineItem) => void;
  onDelete?: (item: PipelineItem) => void;
  enabled?: boolean;
}

export function usePipelineKeyboard({
  stages,
  itemsByStage,
  onReclassify,
  onDelete,
  enabled = true,
}: UsePipelineKeyboardProps) {
  const navigate = useNavigate();
  const [focusedStageIndex, setFocusedStageIndex] = useState<number | null>(null);
  const [focusedItemIndex, setFocusedItemIndex] = useState<number | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);

  // Get currently focused item
  const getFocusedItem = useCallback((): PipelineItem | null => {
    if (focusedStageIndex === null || focusedItemIndex === null) return null;
    const stage = stages[focusedStageIndex];
    if (!stage) return null;
    const items = itemsByStage[stage.id] || [];
    return items[focusedItemIndex] || null;
  }, [focusedStageIndex, focusedItemIndex, stages, itemsByStage]);

  // Find next non-empty stage
  const findNextNonEmptyStage = useCallback((currentIndex: number, direction: 1 | -1): number | null => {
    let index = currentIndex + direction;
    while (index >= 0 && index < stages.length) {
      const stage = stages[index];
      const items = itemsByStage[stage.id] || [];
      if (items.length > 0) return index;
      index += direction;
    }
    return null;
  }, [stages, itemsByStage]);

  // Start keyboard navigation
  const startNavigation = useCallback(() => {
    if (isNavigating) return;
    
    // Find first non-empty stage
    const firstStageIndex = findNextNonEmptyStage(-1, 1);
    if (firstStageIndex !== null) {
      setFocusedStageIndex(firstStageIndex);
      setFocusedItemIndex(0);
      setIsNavigating(true);
      toast.info("Navegación por teclado activada", {
        description: "↑↓ items, ←→ columnas, Enter ver, R reclasificar, Del eliminar, Esc salir",
        duration: 3000,
      });
    }
  }, [isNavigating, findNextNonEmptyStage]);

  // Stop keyboard navigation
  const stopNavigation = useCallback(() => {
    setFocusedStageIndex(null);
    setFocusedItemIndex(null);
    setIsNavigating(false);
  }, []);

  // Handle keyboard events
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      // Start navigation with Tab or arrow keys when not navigating
      if (!isNavigating) {
        if (e.key === "Tab" && !e.shiftKey) {
          e.preventDefault();
          startNavigation();
          return;
        }
        return;
      }

      // Escape to exit navigation
      if (e.key === "Escape") {
        e.preventDefault();
        stopNavigation();
        toast.info("Navegación por teclado desactivada");
        return;
      }

      const currentStage = focusedStageIndex !== null ? stages[focusedStageIndex] : null;
      const currentItems = currentStage ? itemsByStage[currentStage.id] || [] : [];

      switch (e.key) {
        case "ArrowUp": {
          e.preventDefault();
          if (focusedItemIndex !== null && focusedItemIndex > 0) {
            setFocusedItemIndex(focusedItemIndex - 1);
          }
          break;
        }

        case "ArrowDown": {
          e.preventDefault();
          if (focusedItemIndex !== null && focusedItemIndex < currentItems.length - 1) {
            setFocusedItemIndex(focusedItemIndex + 1);
          }
          break;
        }

        case "ArrowLeft": {
          e.preventDefault();
          if (focusedStageIndex !== null) {
            const prevStageIndex = findNextNonEmptyStage(focusedStageIndex, -1);
            if (prevStageIndex !== null) {
              setFocusedStageIndex(prevStageIndex);
              const prevItems = itemsByStage[stages[prevStageIndex].id] || [];
              setFocusedItemIndex(Math.min(focusedItemIndex || 0, prevItems.length - 1));
            }
          }
          break;
        }

        case "ArrowRight": {
          e.preventDefault();
          if (focusedStageIndex !== null) {
            const nextStageIndex = findNextNonEmptyStage(focusedStageIndex, 1);
            if (nextStageIndex !== null) {
              setFocusedStageIndex(nextStageIndex);
              const nextItems = itemsByStage[stages[nextStageIndex].id] || [];
              setFocusedItemIndex(Math.min(focusedItemIndex || 0, nextItems.length - 1));
            }
          }
          break;
        }

        case "Enter": {
          e.preventDefault();
          const item = getFocusedItem();
          if (item) {
            if (item.type === "filing" || item.type === "tutela") {
              navigate(`/filings/${item.id}`);
            } else if (item.type === "process" || item.type === "admin") {
              navigate(`/process-status/${item.id}`);
            } else if (item.type === "cpaca") {
              navigate(`/cpaca/${item.id}`);
            } else if (item.type === "peticion") {
              navigate(`/peticiones/${item.id}`);
            }
            stopNavigation();
          }
          break;
        }

        case "Delete":
        case "Backspace": {
          e.preventDefault();
          const item = getFocusedItem();
          if (item && onDelete) {
            onDelete(item);
          }
          break;
        }

        case "r":
        case "R": {
          e.preventDefault();
          const item = getFocusedItem();
          if (item) {
            onReclassify(item as PipelineItem);
          }
          break;
        }

        case "Home": {
          e.preventDefault();
          setFocusedItemIndex(0);
          break;
        }

        case "End": {
          e.preventDefault();
          if (currentItems.length > 0) {
            setFocusedItemIndex(currentItems.length - 1);
          }
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    isNavigating,
    focusedStageIndex,
    focusedItemIndex,
    stages,
    itemsByStage,
    startNavigation,
    stopNavigation,
    findNextNonEmptyStage,
    getFocusedItem,
    navigate,
    onReclassify,
    onDelete,
  ]);

  return {
    focusedStageIndex,
    focusedItemIndex,
    isNavigating,
    startNavigation,
    stopNavigation,
    getFocusedItem,
    getFocusedItemId: useCallback(() => {
      const item = getFocusedItem();
      return item ? `${item.type}:${item.id}` : null;
    }, [getFocusedItem]),
  };
}
