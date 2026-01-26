-- Add read_at and snoozed_until columns for bulk alert management
ALTER TABLE public.alert_instances
ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE NULL;

ALTER TABLE public.alert_instances
ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP WITH TIME ZONE NULL;

-- Create index for efficient filtering of snoozed alerts
CREATE INDEX IF NOT EXISTS idx_alert_instances_snoozed_until 
ON public.alert_instances(snoozed_until) 
WHERE snoozed_until IS NOT NULL;

-- Create index for efficient filtering of unread alerts
CREATE INDEX IF NOT EXISTS idx_alert_instances_read_at 
ON public.alert_instances(read_at) 
WHERE read_at IS NULL;

COMMENT ON COLUMN public.alert_instances.read_at IS 'Timestamp when the alert was marked as read';
COMMENT ON COLUMN public.alert_instances.snoozed_until IS 'Alerts with snoozed_until > now() should be hidden from active view';