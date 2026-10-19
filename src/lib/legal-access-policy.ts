/** Scroll gating applies only to a visible, loaded canonical document. */
export function isLegalDocumentEndVisible(scrollHeight: number, clientHeight: number, scrollTop: number): boolean {
  return clientHeight > 0 && scrollHeight - scrollTop - clientHeight < 50;
}