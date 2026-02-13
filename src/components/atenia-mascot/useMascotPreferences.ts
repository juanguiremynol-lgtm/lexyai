import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MascotPreferences {
  visible: boolean;
  tips_enabled: boolean;
  position: "top-right" | "bottom-right" | "bottom-left";
}

const DEFAULT_PREFERENCES: MascotPreferences = {
  visible: true,
  tips_enabled: true,
  position: "bottom-right",
};

export function useMascotPreferences() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  const { data: prefs } = useQuery({
    queryKey: ["mascot-preferences", userId],
    queryFn: async () => {
      if (!userId) return DEFAULT_PREFERENCES;
      const { data, error } = await supabase
        .from("profiles")
        .select("mascot_preferences")
        .eq("id", userId)
        .single();
      if (error || !data?.mascot_preferences) return DEFAULT_PREFERENCES;
      return { ...DEFAULT_PREFERENCES, ...(data.mascot_preferences as Partial<MascotPreferences>) } as MascotPreferences;
    },
    enabled: !!userId,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });

  const updatePrefs = useCallback(
    async (updates: Partial<MascotPreferences>) => {
      if (!userId) return;
      const newPrefs = { ...(prefs ?? DEFAULT_PREFERENCES), ...updates };
      await supabase
        .from("profiles")
        .update({ mascot_preferences: newPrefs as unknown as import("@/integrations/supabase/types").Json })
        .eq("id", userId);
      queryClient.setQueryData(["mascot-preferences", userId], newPrefs);
    },
    [prefs, userId, queryClient]
  );

  return { prefs: prefs ?? DEFAULT_PREFERENCES, updatePrefs };
}
