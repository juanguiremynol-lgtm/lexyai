-- Add pattern match explanation column to cgp_milestones
ALTER TABLE public.cgp_milestones 
ADD COLUMN IF NOT EXISTS pattern_match_explanation jsonb DEFAULT NULL;

-- The jsonb structure will be:
-- {
--   "pattern_id": "uuid",
--   "pattern_regex": "regex string",
--   "matched_text": "the text that matched",
--   "derived_milestone_type": "AUTO_ADMISORIO",
--   "keywords_matched": ["keyword1", "keyword2"],
--   "match_position": { "start": 0, "end": 10 },
--   "matched_at": "2025-01-24T00:00:00Z"
-- }

COMMENT ON COLUMN public.cgp_milestones.pattern_match_explanation IS 'Stores explanation of which pattern matched and why for auto-detected milestones';

-- Also add to process_events for inline milestone indicators
ALTER TABLE public.process_events 
ADD COLUMN IF NOT EXISTS detected_milestones jsonb DEFAULT NULL;

COMMENT ON COLUMN public.process_events.detected_milestones IS 'Array of milestone detections from pattern matching for display in timeline';