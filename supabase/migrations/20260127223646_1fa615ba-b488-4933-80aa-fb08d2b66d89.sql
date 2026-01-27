-- Migration: Add scraping metadata columns to work_items
ALTER TABLE work_items 
ADD COLUMN IF NOT EXISTS last_scrape_initiated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS scrape_job_id TEXT,
ADD COLUMN IF NOT EXISTS scrape_poll_url TEXT,
ADD COLUMN IF NOT EXISTS scrape_provider TEXT;

-- Index for monitoring scraping jobs in progress
CREATE INDEX IF NOT EXISTS idx_work_items_scrape_status_in_progress 
ON work_items(scrape_status) 
WHERE scrape_status = 'IN_PROGRESS';

-- Comment for documentation
COMMENT ON COLUMN work_items.last_scrape_initiated_at IS 'Timestamp when scraping job was last initiated';
COMMENT ON COLUMN work_items.scrape_job_id IS 'ID of the current/last scraping job';
COMMENT ON COLUMN work_items.scrape_poll_url IS 'URL to poll for scraping job status';
COMMENT ON COLUMN work_items.scrape_provider IS 'Provider that is/was running the scraping job';