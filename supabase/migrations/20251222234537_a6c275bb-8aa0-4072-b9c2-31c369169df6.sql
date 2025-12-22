-- Add expediente digital URL field to monitored_processes
ALTER TABLE public.monitored_processes 
ADD COLUMN expediente_digital_url text;