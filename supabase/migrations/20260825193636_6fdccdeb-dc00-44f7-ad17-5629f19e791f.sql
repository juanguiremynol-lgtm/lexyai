CREATE POLICY "Backend manages estados monitor runs"
ON public.estados_monitor_runs FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY "Backend manages estados monitor run items"
ON public.estados_monitor_run_items FOR ALL TO service_role
USING (true) WITH CHECK (true);