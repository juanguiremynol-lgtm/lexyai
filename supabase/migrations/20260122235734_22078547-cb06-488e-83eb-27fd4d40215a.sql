-- CGP REDESIGN MIGRATION (Simplified)
-- Add CGP process type metadata columns

-- 1. Add new columns to work_items for CGP classification
ALTER TABLE work_items 
ADD COLUMN IF NOT EXISTS cgp_class text,
ADD COLUMN IF NOT EXISTS cgp_variant text,
ADD COLUMN IF NOT EXISTS cgp_cuantia text,
ADD COLUMN IF NOT EXISTS cgp_instancia text,
ADD COLUMN IF NOT EXISTS notification_substatus text,
ADD COLUMN IF NOT EXISTS notification_effective_date timestamptz,
ADD COLUMN IF NOT EXISTS migration_note text;

-- 2. Create CGP deadline rules table
CREATE TABLE IF NOT EXISTS cgp_deadline_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  cgp_variant text NOT NULL,
  trigger_event text NOT NULL,
  deadline_days integer NOT NULL,
  deadline_type text NOT NULL,
  description text,
  is_default boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cgp_deadline_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view deadline rules" ON cgp_deadline_rules
  FOR SELECT USING (auth.uid() = owner_id OR is_default = true);

CREATE POLICY "Users can manage own deadline rules" ON cgp_deadline_rules
  FOR ALL USING (auth.uid() = owner_id);

-- 3. Create CGP deadlines tracking table  
CREATE TABLE IF NOT EXISTS cgp_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  work_item_id uuid REFERENCES work_items(id) ON DELETE CASCADE NOT NULL,
  trigger_event text NOT NULL,
  trigger_date date NOT NULL,
  deadline_date date NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cgp_deadlines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own deadlines" ON cgp_deadlines
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can manage own deadlines" ON cgp_deadlines
  FOR ALL USING (auth.uid() = owner_id);

-- 4. Create indexes
CREATE INDEX IF NOT EXISTS idx_cgp_deadlines_work_item ON cgp_deadlines(work_item_id);
CREATE INDEX IF NOT EXISTS idx_cgp_deadlines_status ON cgp_deadlines(status, deadline_date);