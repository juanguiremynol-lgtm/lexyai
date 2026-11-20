import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { compileFunction } from "node:vm";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

// SDK 0.20.x externalizes C:\… as an npm package. Give only the Windows
// generator an esbuild resolver for absolute files before its npm resolver.
// The SDK still owns emission, dependency versions, environment and watch mode.
export function projectMcpPlugin() {
  if (process.platform !== "win32") return mcpPlugin();
  const sdkFile = createRequire(import.meta.url).resolve("@lovable.dev/mcp-js/stacks/supabase/vite");
  const sdkRequire = createRequire(sdkFile);
  const windowsPaths = {
    name: "mcp-windows-absolute-files",
    setup(build) {
      build.onResolve({ filter: /^[A-Za-z]:[\\/]/ }, ({ path }) => ({ path }));
    },
  };
  function requireForGenerator(specifier) {
    const dependency = sdkRequire(specifier);
    if (specifier !== "esbuild") return dependency;
    return { ...dependency, build: (options) => dependency.build({
      ...options, plugins: [windowsPaths, ...(options.plugins ?? [])],
    }) };
  }
  const sdkModule = { exports: {} };
  const loadSdk = compileFunction(readFileSync(sdkFile, "utf8"),
    ["require", "module", "exports", "__filename", "__dirname"], { filename: sdkFile });
  loadSdk(requireForGenerator, sdkModule, sdkModule.exports, sdkFile, dirname(sdkFile));
  return sdkModule.exports.mcpPlugin();
}
