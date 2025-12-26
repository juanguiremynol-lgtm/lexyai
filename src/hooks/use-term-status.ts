import { useQuery } from "@tanstack/react-query";
import { getTodayTermStatus } from "@/lib/term-calculator";

/**
 * Hook to get the current term status for both regimes
 * Refreshes every minute to stay current
 */
export function useTermStatus() {
  return useQuery({
    queryKey: ["term-status"],
    queryFn: getTodayTermStatus,
    staleTime: 1000 * 60, // 1 minute
    refetchInterval: 1000 * 60, // Refetch every minute
  });
}
