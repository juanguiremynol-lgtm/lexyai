-- Add linking between filings and monitored_processes
ALTER TABLE monitored_processes ADD COLUMN IF NOT EXISTS linked_filing_id uuid REFERENCES filings(id) ON DELETE SET NULL;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS linked_process_id uuid REFERENCES monitored_processes(id) ON DELETE SET NULL;

-- Add demandantes/demandados to filings for data harmony
ALTER TABLE filings ADD COLUMN IF NOT EXISTS demandantes text;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS demandados text;

-- Add has_auto_admisorio flag to both tables
ALTER TABLE filings ADD COLUMN IF NOT EXISTS has_auto_admisorio boolean DEFAULT false;
ALTER TABLE monitored_processes ADD COLUMN IF NOT EXISTS has_auto_admisorio boolean DEFAULT true;

-- Create indexes for the linking columns
CREATE INDEX IF NOT EXISTS idx_monitored_processes_linked_filing ON monitored_processes(linked_filing_id);
CREATE INDEX IF NOT EXISTS idx_filings_linked_process ON filings(linked_process_id);