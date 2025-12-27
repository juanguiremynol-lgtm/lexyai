-- Create app_role enum for user roles
CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'member');

-- Create subscription_plans table
CREATE TABLE public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE, -- 'trial', 'basic', 'standard', 'unlimited'
  display_name TEXT NOT NULL,
  price_cop INTEGER NOT NULL DEFAULT 0,
  max_clients INTEGER, -- NULL for unlimited
  max_filings INTEGER, -- NULL for unlimited (includes procesos, tutelas, peticiones, admin)
  trial_days INTEGER DEFAULT 0,
  features JSONB DEFAULT '[]'::jsonb,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

-- Everyone can view active plans
CREATE POLICY "Anyone can view active plans"
ON public.subscription_plans
FOR SELECT
USING (active = true);

-- Create subscriptions table
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL UNIQUE,
  plan_id UUID REFERENCES public.subscription_plans(id) NOT NULL,
  status TEXT NOT NULL DEFAULT 'trialing', -- 'trialing', 'active', 'past_due', 'canceled', 'expired'
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  stripe_customer_id TEXT, -- for future Stripe integration
  stripe_subscription_id TEXT, -- for future Stripe integration
  payment_method TEXT, -- for future payment tracking
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can view their organization's subscription
CREATE POLICY "Users can view own organization subscription"
ON public.subscriptions
FOR SELECT
USING (organization_id = public.get_user_organization_id());

-- Users can update their organization's subscription (for status changes)
CREATE POLICY "Users can update own organization subscription"
ON public.subscriptions
FOR UPDATE
USING (organization_id = public.get_user_organization_id());

-- Create user_roles table for access control
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Security definer function to check organization role
CREATE OR REPLACE FUNCTION public.has_org_role(_user_id uuid, _org_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND organization_id = _org_id
      AND role = _role
  )
$$;

-- Users can view roles in their organization
CREATE POLICY "Users can view roles in their organization"
ON public.user_roles
FOR SELECT
USING (organization_id = public.get_user_organization_id());

-- Owners/admins can manage roles in their organization
CREATE POLICY "Owners can insert roles"
ON public.user_roles
FOR INSERT
WITH CHECK (
  organization_id = public.get_user_organization_id() 
  AND public.has_org_role(auth.uid(), organization_id, 'owner')
);

CREATE POLICY "Owners can delete roles"
ON public.user_roles
FOR DELETE
USING (
  organization_id = public.get_user_organization_id() 
  AND public.has_org_role(auth.uid(), organization_id, 'owner')
);

-- Insert default subscription plans
INSERT INTO public.subscription_plans (name, display_name, price_cop, max_clients, max_filings, trial_days, features) VALUES
('trial', 'Prueba Gratuita', 0, 5, 10, 90, '["Acceso básico", "Hasta 5 clientes", "Hasta 10 procesos"]'::jsonb),
('basic', 'Básico', 50000, 20, 30, 0, '["Hasta 20 clientes", "Hasta 30 procesos", "Monitoreo de procesos", "Alertas por correo"]'::jsonb),
('standard', 'Estándar', 100000, 50, 60, 0, '["Hasta 50 clientes", "Hasta 60 procesos", "Monitoreo de procesos", "Alertas por correo", "Importación Excel"]'::jsonb),
('unlimited', 'Ilimitado', 170000, NULL, NULL, 0, '["Clientes ilimitados", "Procesos ilimitados", "Todas las funcionalidades", "Soporte prioritario"]'::jsonb);

-- Function to create subscription on new organization
CREATE OR REPLACE FUNCTION public.create_trial_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trial_plan_id UUID;
BEGIN
  -- Get the trial plan
  SELECT id INTO trial_plan_id FROM public.subscription_plans WHERE name = 'trial' LIMIT 1;
  
  -- Create trial subscription for new organization
  IF trial_plan_id IS NOT NULL THEN
    INSERT INTO public.subscriptions (
      organization_id, 
      plan_id, 
      status, 
      trial_started_at,
      trial_ends_at
    ) VALUES (
      NEW.id, 
      trial_plan_id, 
      'trialing',
      now(),
      now() + INTERVAL '90 days'
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger to create trial subscription on new organization
CREATE TRIGGER on_organization_created
AFTER INSERT ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.create_trial_subscription();

-- Function to assign owner role when user creates organization
CREATE OR REPLACE FUNCTION public.assign_owner_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When a profile gets an organization_id, check if they should be owner
  IF NEW.organization_id IS NOT NULL AND OLD.organization_id IS NULL THEN
    -- Check if there are no existing owners for this org
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE organization_id = NEW.organization_id AND role = 'owner'
    ) THEN
      INSERT INTO public.user_roles (user_id, organization_id, role)
      VALUES (NEW.id, NEW.organization_id, 'owner')
      ON CONFLICT (user_id, organization_id) DO NOTHING;
    ELSE
      -- Add as member if org already has owner
      INSERT INTO public.user_roles (user_id, organization_id, role)
      VALUES (NEW.id, NEW.organization_id, 'member')
      ON CONFLICT (user_id, organization_id) DO NOTHING;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger for assigning roles
CREATE TRIGGER on_profile_org_assigned
AFTER UPDATE OF organization_id ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.assign_owner_role();

-- Create subscriptions for existing organizations
INSERT INTO public.subscriptions (organization_id, plan_id, status, trial_started_at, trial_ends_at)
SELECT 
  o.id,
  (SELECT id FROM public.subscription_plans WHERE name = 'trial' LIMIT 1),
  'trialing',
  now(),
  now() + INTERVAL '90 days'
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscriptions s WHERE s.organization_id = o.id
);

-- Create owner roles for existing users
INSERT INTO public.user_roles (user_id, organization_id, role)
SELECT 
  p.id,
  p.organization_id,
  'owner'::app_role
FROM public.profiles p
WHERE p.organization_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM public.user_roles ur 
  WHERE ur.user_id = p.id AND ur.organization_id = p.organization_id
);

-- Update trigger for subscriptions
CREATE TRIGGER update_subscriptions_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Update trigger for subscription_plans
CREATE TRIGGER update_subscription_plans_updated_at
BEFORE UPDATE ON public.subscription_plans
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();