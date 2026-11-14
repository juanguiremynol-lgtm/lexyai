/** One bounded dispatch, never a replay after an uncertain network response. */
export async function dispatchContinuation(send: () => Promise<Response>) {
  try {
    const response = await send();
    return {
      continuation_enqueued: response.ok,
      continuation_block_reason: response.ok ? null : `CONTINUATION_HTTP_${response.status}`,
      last_error: response.ok ? null : `continuation_dispatch: HTTP ${response.status}`,
    };
  } catch {
    return { continuation_enqueued: false, continuation_block_reason: 'CONTINUATION_DISPATCH_UNCONFIRMED',
      last_error: 'continuation_dispatch: response unconfirmed; no automatic redispatch' };
  }
}