-- IW3 — ICARUS RETIRED.
--
-- Icarus predates the Cloud Run scrapers and providers. It has no live path
-- into Andromeda: the six edge functions are undeployed, the UI is removed and
-- no code reads or writes these tables.
--
-- WHAT IS DELETED: the run-history tables, which describe Icarus imports and
-- syncs that will never happen again. `icarus_import_rows` (105) is the
-- staging detail of those runs and is dropped FIRST, explicitly, so nothing
-- rides in on a CASCADE we did not name.
--
-- WHAT IS NOT TOUCHED: the 40 `work_item_acts` rows carrying
-- source = 'icarus_import'. They were real actuaciones and they remain
-- evidence. Their provenance stays ON THE ROW; what disappears is the word
-- from the live vocabulary of the interface. The `item_source` enum keeps
-- 'ICARUS_IMPORT' for exactly that reason — dropping the label would
-- invalidate the history it describes.

DROP TABLE IF EXISTS public.icarus_import_rows;
DROP TABLE IF EXISTS public.icarus_import_runs;
DROP TABLE IF EXISTS public.icarus_sync_runs;