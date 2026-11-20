// Regenerate the deployable MCP bundle using the project's own Vite plugin.
import { projectMcpPlugin } from './mcp-vite-plugin.mjs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const plugin=projectMcpPlugin();
await plugin.configResolved({root,envDir:root,envPrefix:'VITE_',base:'/'});
console.log('MCP regenerated from src/lib/mcp/index.ts');
