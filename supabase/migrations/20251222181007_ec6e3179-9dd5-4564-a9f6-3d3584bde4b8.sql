-- Add new columns for ICARUS credential-based authentication
ALTER TABLE public.integrations 
ADD COLUMN IF NOT EXISTS username text,
ADD COLUMN IF NOT EXISTS password_encrypted text,
ADD COLUMN IF NOT EXISTS session_encrypted text,
ADD COLUMN IF NOT EXISTS session_last_ok_at timestamp with time zone;

-- Add comment for documentation
COMMENT ON COLUMN public.integrations.username IS 'ICARUS username (email) - stored plaintext as it is not sensitive';
COMMENT ON COLUMN public.integrations.password_encrypted IS 'ICARUS password encrypted with AES-256-GCM';
COMMENT ON COLUMN public.integrations.session_encrypted IS 'Encrypted cookie jar and JSF state for maintaining session';
COMMENT ON COLUMN public.integrations.session_last_ok_at IS 'Last time the session was verified as working';