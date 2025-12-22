-- Add client_id to monitored_processes to link processes to clients
ALTER TABLE public.monitored_processes ADD COLUMN client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;