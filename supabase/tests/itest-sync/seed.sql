insert into auth.users(id,email) values ('11111111-1111-1111-1111-111111111111','itest@example.invalid');
insert into public.organizations(id,name) values ('22222222-2222-2222-2222-222222222222','ITEST ORG');
insert into public.profiles(id,email,organization_id) values ('11111111-1111-1111-1111-111111111111','itest@example.invalid','22222222-2222-2222-2222-222222222222');
insert into public.work_items(id,owner_id,organization_id,workflow_type,stage,radicado,monitoring_enabled)
values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','CPACA','ADMISION','99999233300020260000100',true);
