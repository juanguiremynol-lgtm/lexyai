import { toCanonicalPubRow } from "./canonicalPublicacionMapper.ts";
import { selectPublicationCopy } from "./publicationDocumentCopy.ts";
function assert(v:unknown){if(!v)throw new Error("assertion failed");}
Deno.test("a PP link and downloadable classification do not prove a recovered file",()=>{
 const row=toCanonicalPubRow({key:"estado:A",article_id:"A",tipo:"estado",titulo:"Estado público",fecha_publicacion:"2026-10-20",pdf_url:"https://example.invalid/public.pdf",clasificacion:{es_descargable:true}}, {work_item_id:"work",organization_id:"org",source:"publicaciones"});
 assert(row.pdf_url!==null && row.pdf_available===false);
});
Deno.test("existing recovered copy remains accessible through its exact association",()=>{
 const selected=selectPublicationCopy({id:"pub",work_item_id:"work",organization_id:"org",pdf_storage_path:"org/work/public.pdf"},[{publicacion_id:"pub",work_item_id:"work",organization_id:"org",status:"downloaded",storage_path:"org/work/public.pdf"}],null);
 assert(selected.path==="org/work/public.pdf");
});
Deno.test("a copied file from another organization never makes this publication available",()=>{
 const selected=selectPublicationCopy({id:"pub",work_item_id:"work",organization_id:"org"},[{publicacion_id:"pub",work_item_id:"work",organization_id:"other",status:"downloaded",storage_path:"other/work/public.pdf"}],null);
 assert(selected.path===null && selected.error==="document_recovery_pending");
});
