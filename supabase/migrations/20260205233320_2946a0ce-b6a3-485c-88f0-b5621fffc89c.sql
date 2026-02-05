-- Index for tutela_code lookups (speeds up TUTELAS provider queries)
CREATE INDEX IF NOT EXISTS idx_work_items_tutela_code
  ON work_items (tutela_code)
  WHERE tutela_code IS NOT NULL;