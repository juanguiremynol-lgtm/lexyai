export function sourceGrantToken(doc: Record<string, any>) {
  if (typeof doc.tokenDocumento === 'string' && doc.tokenDocumento) return doc.tokenDocumento;
  for (const key of ['urlDescargaOriginal','url_origen','urlDescarga','url','urlVerOriginal','urlVer']) {
    try {
      const url=new URL(doc[key]);
      if(url.protocol!=='https:' || url.hostname!=='samaicore.consejodeestado.gov.co') continue;
      for(const [name,value] of url.searchParams) if (['tokendoc','tokendocumento'].includes(name.toLowerCase())) return value;
    } catch { /* Legacy descriptor without a source URL. */ }
  }
  return doc.id;
}
// Descriptor identity only. Decoding a source token confers no access and does
// not verify a signature or prove that its hash matches downloaded file bytes.
export function samaiGrantIdentity(doc: Record<string, any>): string | null {
  try {
    const token=sourceGrantToken(doc);
    if(typeof token!=='string') return null;
    const parts=token.split(/[,.]/); if(parts.length!==3) return null;
    const p=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0))));
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
