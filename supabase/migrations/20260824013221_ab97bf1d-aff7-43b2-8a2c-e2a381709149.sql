WITH src AS (
  SELECT lower(split_part(sender,'@',2)) AS domain, lower(sender) AS email, count(*) AS c
    FROM public.work_item_email_links
   WHERE link_status = 'CONFIRMED' AND sender IS NOT NULL AND sender LIKE '%@%'
   GROUP BY 1,2
), inst AS (
  SELECT * FROM src
   WHERE domain LIKE '%.gov.co'
     AND domain NOT IN (SELECT domain FROM public.authority_domain_blocklist)
), doms AS (
  SELECT domain, sum(c) AS c FROM inst GROUP BY 1
), ins_auth AS (
  INSERT INTO public.authorities (organization_id, canonical_name, aliases, authority_kind, is_system)
  SELECT NULL, domain, ARRAY[domain], 'ENTIDAD_PUBLICA', true FROM doms
  RETURNING id, canonical_name
), ins_dom AS (
  INSERT INTO public.authority_domains (authority_id, organization_id, domain, verification_status, verification_source, verified_at, observed_count)
  SELECT a.id, NULL, d.domain, 'VERIFIED', 'CONFIRMED_LINK', now(), d.c
    FROM ins_auth a JOIN doms d ON d.domain = a.canonical_name
  RETURNING 1
)
INSERT INTO public.authority_addresses (authority_id, organization_id, email, address_role, verification_status, verification_source, observed_count)
SELECT a.id, NULL, i.email, 'SENDING', 'VERIFIED', 'CONFIRMED_LINK', i.c
  FROM inst i JOIN ins_auth a ON a.canonical_name = i.domain
ON CONFLICT DO NOTHING;