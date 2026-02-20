
-- Fix search_path on newly created functions
ALTER FUNCTION public.guard_last_synced_at() SET search_path = public;
ALTER FUNCTION public.guard_sync_append_only() SET search_path = public;
