import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

// The preview plugin host may hand configResolved a config without envDir;
// default it to the project root so the MCP plugin's loadEnv does not crash.
function mcpPluginSafe() {
  const plugin: any = mcpPlugin();
  const original = plugin.configResolved;
  if (typeof original === "function") {
    plugin.configResolved = function (config: any) {
      return original.call(this, { ...config, root: config?.root ?? projectRoot, envDir: config?.envDir ?? projectRoot, envPrefix: config?.envPrefix ?? "VITE_" });
    };
  }
  return plugin;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Explicit envDir: the plugin host calls loadEnv with config.envDir and
  // crashes when it is undefined.
  root: projectRoot,
  envDir: projectRoot,
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger(), mcpPluginSafe()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(projectRoot, "index.html"),
        demo: path.resolve(projectRoot, "demo/index.html"),
        prueba: path.resolve(projectRoot, "prueba/index.html"),
      },
    },
  },
}));
