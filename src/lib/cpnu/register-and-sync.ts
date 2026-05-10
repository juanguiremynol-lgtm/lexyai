/**
 * register-and-sync.ts — Legacy fire-and-forget registration helpers.
 *
 * Historically these called provider-specific Cloud Run APIs to register a
 * work item and trigger an initial sync. The Andromeda Read API does not
 * expose any per-item registration or sync endpoints, so all functions here
 * are now NO-OPS. Daily server-side sync-jobs are responsible for hydrating
 * data; the frontend never triggers external syncs directly.
 *
 * The exports are preserved so existing callers keep compiling. Once all
 * call sites are removed these stubs can be deleted.
 */

export async function registerAndSyncCpnu(_workItemId: string, _radicado: string): Promise<boolean> {
  console.warn("[registerAndSyncCpnu] no-op — per-item registration endpoint does not exist");
  return false;
}

export async function registerAndSyncPp(_workItemId: string, _radicado: string): Promise<boolean> {
  console.warn("[registerAndSyncPp] no-op — per-item registration endpoint does not exist");
  return false;
}

export async function registerAndSyncSamai(_workItemId: string, _radicado: string): Promise<boolean> {
  console.warn("[registerAndSyncSamai] no-op — per-item registration endpoint does not exist");
  return false;
}
