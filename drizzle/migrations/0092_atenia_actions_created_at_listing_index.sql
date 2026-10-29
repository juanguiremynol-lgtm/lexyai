SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
CREATE INDEX IF NOT EXISTS idx_atenia_ai_actions_created_at ON public.atenia_ai_actions USING btree (created_at DESC);
COMMENT ON INDEX public.idx_atenia_ai_actions_created_at IS 'Supports the global ORDER BY created_at DESC LIMIT 50 action listing; organization-leading indexes cannot provide this order.';