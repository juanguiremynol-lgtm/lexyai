-- Add all columns needed by sync-publicaciones-by-work-item edge function
ALTER TABLE work_item_publicaciones 
  ADD COLUMN IF NOT EXISTS entry_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pdf_available BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pdf_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fecha_fijacion DATE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS hash_fingerprint TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS raw_json JSONB DEFAULT NULL;