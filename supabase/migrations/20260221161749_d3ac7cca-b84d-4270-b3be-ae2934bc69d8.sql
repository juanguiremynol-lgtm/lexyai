-- Fix search_path for the new function
ALTER FUNCTION public.get_adapter_performance_comparison() SET search_path = public;
