// Validates the GENERATED MCP bundle (supabase/functions/mcp/index.ts).
// The generator emits type-stripped JavaScript, so a strict TS check of the
// artifact is not meaningful; types are checked on the source via
// `tsgo -p tsconfig.mcp.json`. Here we verify the artifact resolves its
// dependency graph, evaluates, and registers its handler. Deno.serve is
// stubbed so nothing listens and no request is made.
// Run: deno run --no-check --allow-all scripts/check-mcp-artifact.ts
let served = false;
(Deno as unknown as { serve: unknown }).serve = () => {
  served = true;
  return {};
};
await import(new URL("../supabase/functions/mcp/index.ts", import.meta.url).href);
if (!served) {
  console.error("MCP artifact did not register a handler");
  Deno.exit(1);
}
console.log("MCP artifact OK: loaded and handler registered");
