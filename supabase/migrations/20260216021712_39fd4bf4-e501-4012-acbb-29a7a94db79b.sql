
-- ================================================
-- Profile Onboarding: Schema changes
-- ================================================

-- 1. Add missing profile fields for onboarding
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz;

-- 2. Add organization type (personal vs business)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'personal'
    CHECK (type IN ('personal', 'business'));

-- Mark existing organizations as 'personal' (can be updated later)
-- Already covered by DEFAULT above.

-- 3. Add max_seats to organizations for seat-limit enforcement
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS max_member_seats integer NOT NULL DEFAULT 5;

-- 4. Create avatars storage bucket (public so avatar URLs work)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 5. Storage policies for avatars
CREATE POLICY "Avatar images are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 6. Server-side function to check profile completion
CREATE OR REPLACE FUNCTION public.is_profile_complete(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_user_id
      AND profile_completed_at IS NOT NULL
  );
$$;

-- 7. Server-side function to enforce seat limits
CREATE OR REPLACE FUNCTION public.check_org_seat_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_seats integer;
  v_current_count integer;
  v_org_type text;
BEGIN
  -- Get org info
  SELECT type, max_member_seats INTO v_org_type, v_max_seats
  FROM organizations WHERE id = NEW.organization_id;

  -- Only enforce for non-OWNER/non-ADMIN roles (i.e., regular members)
  IF NEW.role NOT IN ('OWNER', 'ADMIN', 'ORG_ADMIN') THEN
    SELECT COUNT(*) INTO v_current_count
    FROM organization_memberships
    WHERE organization_id = NEW.organization_id
      AND role NOT IN ('OWNER', 'ADMIN', 'ORG_ADMIN');

    IF v_current_count >= v_max_seats THEN
      RAISE EXCEPTION 'Límite de asientos alcanzado. Máximo % miembros permitidos.', v_max_seats
        USING ERRCODE = 'P0429';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger for seat limit
DROP TRIGGER IF EXISTS enforce_org_seat_limit ON organization_memberships;
CREATE TRIGGER enforce_org_seat_limit
  BEFORE INSERT ON organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.check_org_seat_limit();

-- 8. Allow users to also view org via membership (not just profile FK)
CREATE POLICY "Users can view org via membership"
  ON public.organizations FOR SELECT
  USING (
    id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );
