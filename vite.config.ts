import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

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
  plugins: [react(), mode === "development" && componentTagger(), mcpPlugin()].filter(Boolean),
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
