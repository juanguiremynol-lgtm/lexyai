/**
 * Frontend/test re-export of the shared schema access guard (ITER53/D1).
 * The edge runtime copy is the source; this keeps one implementation.
 */
export {
  classifySchemaAccess,
  MIN_EXPECTED_PUBLIC_TABLES,
  type SchemaAccessProbe,
  type SchemaAccessState,
  type SchemaAccessVerdict,
} from "../../../supabase/functions/_shared/schemaAccessGuard.ts";
