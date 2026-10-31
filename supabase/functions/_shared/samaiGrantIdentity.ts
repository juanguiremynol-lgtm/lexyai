export function sourceGrantToken(doc: Record<string, any>) {
  if (typeof doc.tokenDocumento === 'string' && doc.tokenDocumento) return doc.tokenDocumento;
  for (const key of ['urlDescargaOriginal','url_origen','urlDescarga','url','urlVerOriginal','urlVer']) {
    const raw=doc[key];
    // Skip values that cannot be this host's URL without constructing (and
    // throwing) a URL: exception capture dominated pairwise matching CPU.
    if (typeof raw!=='string' || !/^https:/i.test(raw) || !/samaicore\.consejodeestado\.gov\.co/i.test(raw)) continue;
    try {
      const url=new URL(raw);
      if(url.protocol!=='https:' || url.hostname!=='samaicore.consejodeestado.gov.co') continue;
      for(const [name,value] of url.searchParams) if (['tokendoc','tokendocumento'].includes(name.toLowerCase())) return value;
    } catch { /* Legacy descriptor without a source URL. */ }
  }
  return doc.id;
}
// Decoding is a pure function of the token string; memoized (bounded) because
// pairwise descriptor matching otherwise re-decodes each token O(n^2) times.
const payloadCache = new Map<string, any>();
function grantPayload(token: string): any {
  if (payloadCache.has(token)) return payloadCache.get(token);
  let p: any = null;
  const parts=token.split(/[,.]/);
  if (parts.length===3) {
    try { p=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0)))); } catch { p=null; }
  }
  if (p === null || typeof p !== 'object') p = null; else Object.freeze(p);
  if (payloadCache.size >= 4096) payloadCache.clear();
  payloadCache.set(token, p);
  return p;
}
// Descriptor identity only. Decoding a source token confers no access and does
// not verify a signature or prove that its hash matches downloaded file bytes.
export function samaiGrantIdentity(doc: Record<string, any>): string | null {
  try {
    const token=sourceGrantToken(doc);
    if(typeof token!=='string') return null;
    const p=grantPayload(token); if(!p) return null;
    const label=String(doc.descripcion || doc.nombre || '').trim();
    if(!/^\d{23}$/.test(p.r) || !/^[0-9a-f]{64}$/i.test(p.h) || !label || doc.radicado && String(doc.radicado)!==p.r) return null;
    return JSON.stringify([p.r,p.h.toUpperCase(),...['dt','c','d','cu'].map(k=>String(p[k]??'')),label]);
  } catch { return null; }
}
export function sameSamaiGrant(a: Record<string, any>,b: Record<string, any>): boolean | null {
  const left=samaiGrantIdentity(a),right=samaiGrantIdentity(b);
  if(!left || !right) return null;
  for (const key of ['solicitud','indice_actuacion']) {
    if (a[key] != null && b[key] != null && String(a[key]).replace(/^0+(?=\d)/,'') !== String(b[key]).replace(/^0+(?=\d)/,'')) return false;
  }
  // Native registration ids still take precedence over rotating grants.
  if(a.id && b.id && a.id!==sourceGrantToken(a) && b.id!==sourceGrantToken(b) && a.id!==b.id) return false;
  return left===right;
}
