import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // ── Analytics SDK import restrictions ──
      // All analytics must go through src/lib/analytics wrapper
      "no-restricted-imports": ["error", {
        "patterns": [
          {
            "group": ["posthog-js", "posthog-js/*"],
            "message": "Import from @/lib/analytics instead. Direct PostHog usage bypasses tenant gating, PII redaction, and allowlists."
          },
          {
            "group": ["@sentry/*", "@sentry/browser", "@sentry/react"],
            "message": "Import from @/lib/analytics instead. Direct Sentry usage bypasses tenant gating and PII scrubbing."
          },
          {
            "group": ["logrocket", "logrocket/*"],
            "message": "Import from @/lib/analytics instead. Direct LogRocket usage bypasses privacy controls."
          },
          {
            "group": ["mixpanel-browser", "amplitude-js", "heap-analytics"],
            "message": "Import from @/lib/analytics instead. All analytics must go through the unified wrapper."
          }
        ]
      }],
      // ── External fetch restriction ──
      // Prevent direct external HTTP calls that bypass the egress proxy.
      // Edge functions must use egressClient.ts; frontend code must not call external APIs directly.
      "no-restricted-globals": ["error",
        {
          "name": "fetch",
          "message": "Do not use global fetch() for external URLs. Use egressFetch() from _shared/egressClient.ts for all outbound calls. Internal Supabase calls are fine via the supabase-js client."
        }
      ],
    },
  },
  // ── Override: Allow fetch in specific files ──
  // egressClient.ts, egress-proxy, and supabase client files need raw fetch
  {
    files: [
      "supabase/functions/_shared/egressClient.ts",
      "supabase/functions/egress-proxy/**",
      "src/integrations/supabase/**",
      "supabase/functions/**/index.ts",
    ],
    rules: {
      "no-restricted-globals": "off",
    },
  },
);
