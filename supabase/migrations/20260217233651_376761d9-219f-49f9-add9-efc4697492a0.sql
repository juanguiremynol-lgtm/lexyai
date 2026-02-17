-- Create a public bucket for email assets (logo, etc.)
INSERT INTO storage.buckets (id, name, public)
VALUES ('email-assets', 'email-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "Public read email-assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'email-assets');

-- Allow super admins to upload
CREATE POLICY "Super admins can upload email-assets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'email-assets'
  AND EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
  )
);
