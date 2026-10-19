// Regenerate the deployable MCP bundle using the project's own Vite plugin.
import { mcpPlugin } from '@lovable.dev/mcp-js/stacks/supabase/vite';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const plugin=mcpPlugin();
await plugin.configResolved({root,envDir:root,envPrefix:'VITE_',base:'/'});
console.log('MCP regenerated from src/lib/mcp/index.ts');
