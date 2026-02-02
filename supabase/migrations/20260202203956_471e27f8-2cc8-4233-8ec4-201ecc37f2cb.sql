-- Add missing entry_url column to work_item_publicaciones
ALTER TABLE work_item_publicaciones ADD COLUMN IF NOT EXISTS entry_url TEXT DEFAULT NULL;