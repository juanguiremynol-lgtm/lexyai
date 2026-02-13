
CREATE TABLE IF NOT EXISTS public.user_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  feedback_type TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  organization_id UUID,
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT feedback_type_check CHECK (feedback_type IN ('peticion', 'felicitacion', 'queja', 'comentario'))
);

-- Enable RLS
ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can insert (public form)
CREATE POLICY "Anyone can submit feedback"
ON public.user_feedback
FOR INSERT
WITH CHECK (true);

-- Policy: Only owner can view their own feedback (if user_id is set)
CREATE POLICY "Users can view their own feedback"
ON public.user_feedback
FOR SELECT
USING (user_id = auth.uid() OR user_id IS NULL);

-- Policy: Platform admins can view all feedback
CREATE POLICY "Platform admins can view all feedback"
ON public.user_feedback
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
));

-- Index for queries
CREATE INDEX idx_user_feedback_created ON public.user_feedback(created_at DESC);
CREATE INDEX idx_user_feedback_type ON public.user_feedback(feedback_type);
