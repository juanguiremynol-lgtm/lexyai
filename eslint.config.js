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
    },
  },
);
