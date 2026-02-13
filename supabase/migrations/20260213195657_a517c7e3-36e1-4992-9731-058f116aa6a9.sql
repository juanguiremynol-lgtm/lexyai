-- Enable realtime for billing_subscription_state so payment updates refresh UI instantly
ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_subscription_state;