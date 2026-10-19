import { isAndromedaCopyUrl } from './act-attachments-inventory';

/** The XML object URL opens in a tab but may omit CORS headers. Google's
 * public JSON media route serves the SAME bucket/object with browser CORS.
 * This does not change access rights or request any personal credentials. */
export function documentDownloadUrl(url: string): string {
  if (!isAndromedaCopyUrl(url)) return url;
  const [bucket, ...key] = new URL(url).pathname.slice(1).split('/');
  return `https://storage.googleapis.com/download/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(decodeURIComponent(key.join('/')))}?alt=media`;
}

/** Fetch a blob so cross-origin downloads do not silently become viewer tabs. */
export async function downloadDocument(url: string, filename: string): Promise<void> {
  const response = await fetch(documentDownloadUrl(url), { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('document_download_unavailable');
  const blob = await response.blob();
  if (!blob.size) throw new Error('document_download_empty');
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  const extension = new URL(url).pathname.match(/\.(pdf|zip|xlsx)$/i)?.[0];
  const safeName = filename.replace(/[\\/\u0000-\u001f]/g, '_');
  link.download = extension && !safeName.toLowerCase().endsWith(extension.toLowerCase()) ? safeName + extension : safeName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
