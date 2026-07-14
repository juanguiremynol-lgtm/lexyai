UPDATE public.work_items
   SET authority_city       = COALESCE(NULLIF(authority_city, ''), 'Medellín'),
       authority_department = COALESCE(NULLIF(authority_department, ''), 'Antioquia'),
       updated_at           = now()
 WHERE id = '6153c00f-4e3f-4ee8-aad2-064693ac3bb2';