/**
 * Centralized external API URL.
 *
 * Andromeda Read API is the ONLY backend the frontend talks to directly.
 * The legacy CPNU/PP/SAMAI base URLs and their `*-read-api/work-items*`
 * endpoints no longer exist; all reads go through `andromeda-read-api`.
 */
export const ANDROMEDA_API_BASE = "https://andromeda-read-api-11974381924.us-central1.run.app";
