-- Create table for process events from Rama Judicial crawler
CREATE TABLE public.process_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  filing_id UUID NOT NULL REFERENCES public.filings(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id),
  event_date TIMESTAMP WITH TIME ZONE,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  raw_data JSONB,
  source_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for hearings (audiencias)
CREATE TABLE public.hearings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  filing_id UUID NOT NULL REFERENCES public.filings(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id),
  title TEXT NOT NULL,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  location TEXT,
  notes TEXT,
  is_virtual BOOLEAN DEFAULT false,
  virtual_link TEXT,
  reminder_sent BOOLEAN DEFAULT false,
  auto_detected BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add last_crawled_at to filings to track crawler status
ALTER TABLE public.filings 
ADD COLUMN last_crawled_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN crawler_enabled BOOLEAN DEFAULT false,
ADD COLUMN rama_judicial_url TEXT;

-- Enable RLS on new tables
ALTER TABLE public.process_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hearings ENABLE ROW LEVEL SECURITY;

-- RLS policies for process_events
CREATE POLICY "Users can view own process_events" ON public.process_events FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Users can create own process_events" ON public.process_events FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can delete own process_events" ON public.process_events FOR DELETE USING (auth.uid() = owner_id);

-- RLS policies for hearings
CREATE POLICY "Users can view own hearings" ON public.hearings FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Users can create own hearings" ON public.hearings FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can update own hearings" ON public.hearings FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Users can delete own hearings" ON public.hearings FOR DELETE USING (auth.uid() = owner_id);

-- Trigger for hearings updated_at
CREATE TRIGGER update_hearings_updated_at
BEFORE UPDATE ON public.hearings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.process_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.hearings;