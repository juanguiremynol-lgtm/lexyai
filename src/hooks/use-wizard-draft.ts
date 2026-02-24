/**
 * useWizardDraft — Auto-saves wizard form state to localStorage and restores on mount.
 * 
 * Features:
 * - Debounced autosave (every 2s) to avoid excessive writes
 * - Restore detection with `hasRestoredDraft` flag for showing a banner
 * - `clearDraft()` to remove saved state on completion
 * - `discardDraft()` to reset without completing
 * - Scoped by a unique key (e.g., "wizard-draft-{workItemId}")
 */

import { useCallback, useEffect, useRef, useState } from "react";

const AUTOSAVE_DELAY_MS = 2000;

interface UseWizardDraftOptions<T> {
  /** Unique key scoping this draft (include entity IDs) */
  storageKey: string;
  /** Current form state to persist */
  currentState: T;
  /** Called when a draft is found on mount — should set form state */
  onRestore: (draft: T) => void;
  /** Whether the hook is ready to operate (e.g., data loaded) */
  enabled?: boolean;
}

interface UseWizardDraftReturn {
  /** True if a draft was restored on mount */
  hasRestoredDraft: boolean;
  /** Remove saved draft (call on successful completion) */
  clearDraft: () => void;
  /** Discard restored draft and dismiss the banner */
  discardDraft: () => void;
  /** Timestamp of the last save */
  lastSavedAt: string | null;
}

interface DraftEnvelope<T> {
  data: T;
  savedAt: string;
  version: 1;
}

export function useWizardDraft<T>({
  storageKey,
  currentState,
  onRestore,
  enabled = true,
}: UseWizardDraftOptions<T>): UseWizardDraftReturn {
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredRef = useRef(false);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  // ── Restore on mount ──
  useEffect(() => {
    if (!enabled || restoredRef.current) return;
    restoredRef.current = true;

    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const envelope: DraftEnvelope<T> = JSON.parse(raw);
      if (!envelope?.data || envelope.version !== 1) return;

      // Check if draft is stale (> 7 days)
      const savedDate = new Date(envelope.savedAt);
      const now = new Date();
      if (now.getTime() - savedDate.getTime() > 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(storageKey);
        return;
      }

      onRestoreRef.current(envelope.data);
      setHasRestoredDraft(true);
      setLastSavedAt(envelope.savedAt);
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey, enabled]);

  // ── Debounced autosave ──
  useEffect(() => {
    if (!enabled) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        const envelope: DraftEnvelope<T> = {
          data: currentState,
          savedAt: new Date().toISOString(),
          version: 1,
        };
        localStorage.setItem(storageKey, JSON.stringify(envelope));
        setLastSavedAt(envelope.savedAt);
      } catch {
        // localStorage full or unavailable — silently fail
      }
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [storageKey, currentState, enabled]);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(storageKey);
    setHasRestoredDraft(false);
    setLastSavedAt(null);
  }, [storageKey]);

  const discardDraft = useCallback(() => {
    localStorage.removeItem(storageKey);
    setHasRestoredDraft(false);
  }, [storageKey]);

  return { hasRestoredDraft, clearDraft, discardDraft, lastSavedAt };
}
