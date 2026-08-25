import { runEstadosMonitor } from "../_shared/estadosMonitor.ts";

Deno.serve((req) => runEstadosMonitor(req, "publicaciones"));
