-- Cursor row access remains scoped by verified user and OAuth client.
-- Non-row operations bypass or are unnecessary for that contract.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.mcp_feed_cursors FROM PUBLIC, anon, authenticated, mcp_feed_executor;
