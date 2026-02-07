
-- Lexy Daily Messages table — ONE message per user per day
CREATE TABLE public.lexy_daily_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  message_date DATE NOT NULL,
  
  -- Message content
  greeting TEXT NOT NULL,
  summary_body TEXT NOT NULL,
  highlights JSONB DEFAULT '[]',
  closing TEXT,
  alerts_included JSONB DEFAULT '[]',
  
  -- Metadata
  work_items_covered INT DEFAULT 0,
  new_actuaciones_count INT DEFAULT 0,
  new_publicaciones_count INT DEFAULT 0,
  critical_alerts_count INT DEFAULT 0,
  
  -- Delivery
  delivered_via TEXT[] DEFAULT '{}',
  seen_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, organization_id, message_date)
);

CREATE INDEX idx_lexy_messages_user_date ON public.lexy_daily_messages (user_id, message_date DESC);
CREATE INDEX idx_lexy_messages_org ON public.lexy_daily_messages (organization_id, message_date DESC);

-- RLS
ALTER TABLE public.lexy_daily_messages ENABLE ROW LEVEL SECURITY;

-- Users can read their own messages
CREATE POLICY "Users read own Lexy messages"
ON public.lexy_daily_messages FOR SELECT
USING (auth.uid() = user_id);

-- Users can update seen_at on their own messages
CREATE POLICY "Users update own Lexy messages"
ON public.lexy_daily_messages FOR UPDATE
USING (auth.uid() = user_id);

-- Service role insert (edge functions)
CREATE POLICY "Service role inserts Lexy messages"
ON public.lexy_daily_messages FOR INSERT
WITH CHECK (true);

-- Platform admins can read all
CREATE POLICY "Platform admins read all Lexy messages"
ON public.lexy_daily_messages FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
);
