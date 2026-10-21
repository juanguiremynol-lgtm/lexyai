import { officialPortalRecoveryHash } from './estadoAttachmentRecovery.ts';

/** Add only the exact recovered URLs whose source binding survives in the
 * persisted row. A fresh upstream response may omit that already found PDF.
 * This does not validate bytes or mark an attachment as available. */
export function withRetainedOfficialPublicationUrls(
  upstreamUrls: string[],
  persisted: { raw_data?: unknown },
): string[] {
  const recovery = (persisted.raw_data as Record<string, unknown> | null)?.recuperacion_oficial;
  const urls = new Set(upstreamUrls);
  if (Array.isArray(recovery)) {
    for (const item of recovery) {
      if (typeof item?.url === 'string' && officialPortalRecoveryHash(persisted as any, item.url)) urls.add(item.url);
    }
  }
  return [...urls];
}
