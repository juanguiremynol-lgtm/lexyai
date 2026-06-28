
-- T2c fix: require organization membership on INSERT for every table that has
-- an organization_id column and an owner-only INSERT policy.

-- actuaciones
DROP POLICY IF EXISTS "Org members can create actuaciones" ON public.actuaciones;
CREATE POLICY "Org members can create actuaciones" ON public.actuaciones
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- alert_instances
DROP POLICY IF EXISTS "Users can create their own alert instances" ON public.alert_instances;
CREATE POLICY "Users can create their own alert instances" ON public.alert_instances
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- alert_rules
DROP POLICY IF EXISTS "Users can create their own alert rules" ON public.alert_rules;
CREATE POLICY "Users can create their own alert rules" ON public.alert_rules
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- alerts
DROP POLICY IF EXISTS "Users can create own alerts" ON public.alerts;
CREATE POLICY "Users can create own alerts" ON public.alerts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- clients
DROP POLICY IF EXISTS "Users can create own clients" ON public.clients;
CREATE POLICY "Users can create own clients" ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- contracts
DROP POLICY IF EXISTS "Users can create own contracts" ON public.contracts;
CREATE POLICY "Users can create own contracts" ON public.contracts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- cpaca_processes
DROP POLICY IF EXISTS "Users can create their own CPACA processes" ON public.cpaca_processes;
CREATE POLICY "Users can create their own CPACA processes" ON public.cpaca_processes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- icarus_import_runs
DROP POLICY IF EXISTS "Users can create own import runs" ON public.icarus_import_runs;
CREATE POLICY "Users can create own import runs" ON public.icarus_import_runs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- peticiones
DROP POLICY IF EXISTS "Users can create own peticiones" ON public.peticiones;
CREATE POLICY "Users can create own peticiones" ON public.peticiones
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- process_events
DROP POLICY IF EXISTS "Users can create own process_events" ON public.process_events;
CREATE POLICY "Users can create own process_events" ON public.process_events
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- tasks
DROP POLICY IF EXISTS "Users can create own tasks" ON public.tasks;
CREATE POLICY "Users can create own tasks" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- work_item_acts
DROP POLICY IF EXISTS "Org members can create work item acts" ON public.work_item_acts;
CREATE POLICY "Org members can create work item acts" ON public.work_item_acts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- work_item_deadlines
DROP POLICY IF EXISTS "Users can insert their own work_item_deadlines" ON public.work_item_deadlines;
CREATE POLICY "Users can insert their own work_item_deadlines" ON public.work_item_deadlines
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- work_item_parties
DROP POLICY IF EXISTS "Users can insert their own parties" ON public.work_item_parties;
CREATE POLICY "Users can insert their own parties" ON public.work_item_parties
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- work_item_reminders
DROP POLICY IF EXISTS "Users can create reminders for their work items" ON public.work_item_reminders;
CREATE POLICY "Users can create reminders for their work items" ON public.work_item_reminders
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- work_item_tasks
DROP POLICY IF EXISTS "Users can create tasks" ON public.work_item_tasks;
CREATE POLICY "Users can create tasks" ON public.work_item_tasks
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));

-- work_items
DROP POLICY IF EXISTS "Users can create their own work items" ON public.work_items;
CREATE POLICY "Users can create their own work items" ON public.work_items
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id
              AND (organization_id IS NULL OR public.is_org_member(organization_id)));
