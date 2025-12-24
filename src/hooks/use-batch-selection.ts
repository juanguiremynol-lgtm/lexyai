import { useState, useCallback, useRef } from "react";

export type SelectableItemType = "filing" | "process" | "peticion" | "tutela";

interface SelectableItem {
  id: string;
  type: SelectableItemType;
}

interface UseBatchSelectionProps {
  allItems: SelectableItem[];
}

export function useBatchSelection({ allItems }: UseBatchSelectionProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const lastSelectedRef = useRef<string | null>(null);

  // Get unique key for item
  const getItemKey = useCallback((item: SelectableItem) => `${item.type}:${item.id}`, []);

  // Toggle single item selection
  const toggleSelection = useCallback((item: SelectableItem, shiftKey: boolean) => {
    const itemKey = getItemKey(item);
    
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      
      if (shiftKey && lastSelectedRef.current && allItems.length > 0) {
        // Shift+click: select range
        const lastIndex = allItems.findIndex(i => getItemKey(i) === lastSelectedRef.current);
        const currentIndex = allItems.findIndex(i => getItemKey(i) === itemKey);
        
        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);
          
          for (let i = start; i <= end; i++) {
            newSet.add(getItemKey(allItems[i]));
          }
        }
      } else {
        // Normal click: toggle single item
        if (newSet.has(itemKey)) {
          newSet.delete(itemKey);
        } else {
          newSet.add(itemKey);
        }
      }
      
      lastSelectedRef.current = itemKey;
      return newSet;
    });
    
    setIsSelectionMode(true);
  }, [allItems, getItemKey]);

  // Check if item is selected
  const isSelected = useCallback((item: SelectableItem) => {
    return selectedIds.has(getItemKey(item));
  }, [selectedIds, getItemKey]);

  // Select all items
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(allItems.map(getItemKey)));
    setIsSelectionMode(true);
  }, [allItems, getItemKey]);

  // Select all of a specific type
  const selectAllOfType = useCallback((type: SelectableItemType) => {
    const filtered = allItems.filter(i => i.type === type);
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      filtered.forEach(item => newSet.add(getItemKey(item)));
      return newSet;
    });
    setIsSelectionMode(true);
  }, [allItems, getItemKey]);

  // Clear all selections
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelectionMode(false);
    lastSelectedRef.current = null;
  }, []);

  // Get selected items
  const getSelectedItems = useCallback(() => {
    return allItems.filter(item => selectedIds.has(getItemKey(item)));
  }, [allItems, selectedIds, getItemKey]);

  // Get count by type
  const getSelectionCounts = useCallback(() => {
    const items = getSelectedItems();
    return {
      total: items.length,
      filings: items.filter(i => i.type === "filing").length,
      processes: items.filter(i => i.type === "process").length,
      peticiones: items.filter(i => i.type === "peticion").length,
      tutelas: items.filter(i => i.type === "tutela").length,
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
