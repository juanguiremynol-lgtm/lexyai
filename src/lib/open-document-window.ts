/** Reserve the tab during the click, before any request consumes the browser's
 * user activation. The new page never receives a reference to Andromeda. */
export async function openResolvedDocument(resolve: () => Promise<string | null>): Promise<boolean> {
  const tab = window.open('about:blank', '_blank');
  if (!tab) return false;
  tab.opener = null;
  try {
    const url = await resolve();
    if (!url || !/^https:\/\//i.test(url)) { tab.close(); return false; }
    tab.location.replace(url);
    return true;
  } catch { tab.close(); return false; }
}
