/**
 * useColombianHolidays — Hydrates the shared holiday cache in
 * `src/lib/colombian-holidays.ts` from the authoritative BD table
 * `colombian_holidays`. This eliminates divergence between the FE
 * (previously algorithmic Ley-Emiliani only) and the backend
 * (which reads the table directly).
 *
 * The algorithmic implementation remains as a defensive fallback:
 * if the DB is unreachable, callers still get sensible results and a
 * one-time console warning is emitted.
 *
 * Coverage check: also flags if the current or next year is missing
 * from the table (so we notice before running out of data in 2027+).
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  primeColombianHolidayCache,
  hasDbHolidaysFor,
} from "@/lib/colombian-holidays";

interface HolidayRow {
  holiday_date: string;
  name: string;
}

export function useColombianHolidays() {
  const query = useQuery({
    queryKey: ["colombian-holidays"],
    queryFn: async (): Promise<HolidayRow[]> => {
      const { data, error } = await supabase
        .from("colombian_holidays")
        .select("holiday_date, name")
        .order("holiday_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 60 * 24, // 24h — holidays change rarely
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
  });

  useEffect(() => {
    if (!query.data) return;
    primeColombianHolidayCache(query.data);

    // Coverage alert: warn if current or next year is not represented
    const y = new Date().getFullYear();
    if (!hasDbHolidaysFor(y)) {
      console.warn(
        `[colombian-holidays] BD sin festivos para ${y}. Cargue la tabla colombian_holidays.`,
      );
    }
    if (!hasDbHolidaysFor(y + 1)) {
      console.warn(
        `[colombian-holidays] BD sin festivos para ${y + 1}. Preparar carga anticipada.`,
      );
    }
  }, [query.data]);

  return query;
}
