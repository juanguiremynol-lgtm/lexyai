-- P2: expose a service-role-only view listing email recipients per organization,
-- so the GCP daily digest job can resolve destinatarios via one query instead
-- of hardcoding EMAIL_TO. RLS is disabled on the view; access is granted only
-- to service_role, so the anon key cannot read it.

CREATE OR REPLACE VIEW public.email_recipients_by_org AS
SELECT
  o.id                                                            AS organization_id,
  o.name                                                          AS organization_name,
  p.id                                                            AS user_id,
  COALESCE(
    NULLIF(TRIM(m.alert_email), ''),
    NULLIF(TRIM(p.reminder_email), ''),
    NULLIF(TRIM(p.email), '')
  )                                                               AS to_email,
  p.full_name,
  m.role,
  COALESCE(p.email_reminders_enabled, true)                       AS email_reminders_enabled,
  (m.alert_email IS NOT NULL AND m.alert_email_verified_at IS NOT NULL)
                                                                  AS alert_email_verified,
  o.is_active                                                     AS org_active,
  COALESCE(o.email_suspended, false)                              AS org_email_suspended
FROM public.organizations o
JOIN public.organization_memberships m ON m.organization_id = o.id
JOIN public.profiles p                 ON p.id = m.user_id;

-- Lock down completely; only service_role (used by the GCP job) can read.
REVOKE ALL ON public.email_recipients_by_org FROM PUBLIC;
REVOKE ALL ON public.email_recipients_by_org FROM anon, authenticated;
GRANT SELECT ON public.email_recipients_by_org TO service_role;

COMMENT ON VIEW public.email_recipients_by_org IS
  'Service-role-only view. Feeds the GCP andromeda-email-job so it can send the daily digest to every eligible member of each organization instead of a hardcoded address. Filter with: WHERE org_active AND NOT org_email_suspended AND email_reminders_enabled AND to_email IS NOT NULL.';
