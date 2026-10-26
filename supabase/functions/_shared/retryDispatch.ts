/** Explicit server-to-server identity; never rely on an SDK's implicit session. */
export async function dispatchRetry(
  url: string, serviceKey: string, functionName: string, workItemId: string,
  taskId: string, traceId: string,
): Promise<Response> {
  return await fetch(`${url}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`, apikey: serviceKey,
      "Content-Type": "application/json", "X-Trace-Id": traceId,
      "x-invoker-function": "process-retry-queue", "x-retry-task-id": taskId,
    },
    body: JSON.stringify({ work_item_id: workItemId, force_refresh: functionName === "sync-by-work-item", _scheduled: true }),
    signal: AbortSignal.timeout(35_000),
  });
}