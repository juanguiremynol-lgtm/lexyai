import { useState, useCallback } from "react";

export interface SelectableAlert {
  id: string;
  type: "alert_instance" | "reminder";
}

interface UseAlertSelectionProps {
  allItems: SelectableAlert[];
}

export function useAlertSelection({ allItems }: UseAlertSelectionProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
    setIsSelectionMode(true);
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(allItems.map((item) => item.id)));
    setIsSelectionMode(true);
  }, [allItems]);

  const selectAllOfType = useCallback(
    (type: "alert_instance" | "reminder") => {
      const filtered = allItems.filter((i) => i.type === type);
      setSelectedIds((prev) => {
        const newSet = new Set(prev);
        filtered.forEach((item) => newSet.add(item.id));
        return newSet;
      });
      setIsSelectionMode(true);
    },
    [allItems]
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  }, []);

  const getSelectedItems = useCallback(() => {
    return allItems.filter((item) => selectedIds.has(item.id));
  }, [allItems, selectedIds]);

  const getSelectionCounts = useCallback(() => {
    const items = getSelectedItems();
    return {
      total: items.length,
      alertInstances: items.filter((i) => i.type === "alert_instance").length,
      reminders: items.filter((i) => i.type === "reminder").length,
    };
  }, [getSelectedItems]);

  return {
    selectedIds,
    isSelectionMode,
    toggleSelection,
    isSelected,
    selectAll,
    selectAllOfType,
    clearSelection,
    getSelectedItems,
    getSelectionCounts,
    selectedCount: selectedIds.size,
  };
}
