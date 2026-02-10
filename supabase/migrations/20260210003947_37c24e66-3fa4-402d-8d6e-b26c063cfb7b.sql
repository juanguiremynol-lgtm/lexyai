
-- Add email and avatar_url to profiles for Google OAuth users
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS auth_provider TEXT;

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email);

-- Update handle_new_user to extract Google OAuth metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url, auth_provider)
  VALUES (
    new.id,
    COALESCE(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url',
    COALESCE(new.raw_app_meta_data ->> 'provider', 'email')
  );
  RETURN new;
END;
$$;

-- Backfill email for existing profiles from auth.users
UPDATE public.profiles p
SET email = u.email,
    avatar_url = COALESCE(p.avatar_url, u.raw_user_meta_data ->> 'avatar_url'),
    auth_provider = COALESCE(p.auth_provider, u.raw_app_meta_data ->> 'provider', 'email')
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;
