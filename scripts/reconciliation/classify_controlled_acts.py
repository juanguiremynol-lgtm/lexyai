"""Classify only the72 controlled insertions against their accredited CPNU snapshots.
No DB writes. Native source identity AND corresponding content are required.
"""
import argparse,collections,json,pathlib,re,unicodedata

def norm(s):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC',str(s or '')).casefold()).strip()
def body(title,annotation):
    return norm(str(title or '') + (' - '+str(annotation) if annotation else ''))
def row_body(r):
    rd=r.get('raw_data') or {}
    return body(rd.get('actuacion'),rd.get('anotacion'))
def same_content(row, official):
    expected=body(official.get('actuacion'),official.get('anotacion'))
    # Do not accept a native id retained under another event's annotation.
    return row_body(row)==expected and norm(row.get('description'))==expected

def evidence_origins(row, all_by_id):
    rd=row.get('raw_data') or {}; out=[]
    for key in ['origen_indice','indice']:
        if rd.get(key) is not None:out.append((str(rd[key]),key))
    cf=rd.get('consolidated_from')
    if isinstance(cf,list):
        for e in cf:
            er=e.get('raw_data') or {}
            if str(e.get('source','')).lower()=='cpnu' and body(er.get('actuacion'),er.get('anotacion'))==row_body(row) and er.get('indice') is not None:
                out.append((str(er['indice']),'consolidated_from:'+str(e.get('id'))))
    # An explicit consolidation pointer survives even when the embedded list was replaced.
    if isinstance(cf,dict):
        for sibling_id in cf.get('sibling_ids',[]):
            sibling=all_by_id.get(sibling_id)
            if not sibling or str(sibling.get('source','')).lower()!='cpnu':continue
            sr=sibling.get('raw_data') or {}
            if sr.get('consolidated_into')==row['id'] and row_body(sibling)==row_body(row) and sr.get('indice') is not None:
                out.append((str(sr['indice']),'archived_sibling:'+sibling_id))
    return out

def classify(inventory, rows, official_by_case):
    by_id={r['id']:r for r in rows};controlled={r['id'] for r in inventory};out=[]
    for entry in inventory:
        r=by_id[entry['id']];rd=r.get('raw_data') or {};native=str(rd.get('origen_indice') or rd.get('indice') or '')
        official=[a for a in official_by_case[r['work_item_id']] if str(a.get('consActuacion') or a.get('idRegActuacion'))==native]
        item={'id':r['id'],'work_item_id':r['work_item_id'],'native_act':native,'status':'ambiguo','canonical_id':None,'evidence':[],'documents':r.get('documentos') or []}
        if len(official)!=1:
            item['evidence']=['source native identity absent or non-unique'];out.append(item);continue
        o=official[0];item['official']={k:o.get(k) for k in ['idRegActuacion','consActuacion','_idProceso','fechaActuacion','actuacion','anotacion']}
        if str(r.get('source','')).lower()!='cpnu' or not same_content(r,o) or str(r.get('act_date'))[:10]!=str(o.get('fechaActuacion'))[:10]:
            item['evidence']=['current row does not agree with accredited native content/date'];out.append(item);continue
        candidates=[]
        for old in rows:
            if old['id'] in controlled or old.get('is_archived') or old['work_item_id']!=r['work_item_id'] or old.get('organization_id')!=r.get('organization_id') or str(old.get('source','')).lower()!='cpnu':continue
            if not same_content(old,o) or str(old.get('act_date'))[:10]!=str(o.get('fechaActuacion'))[:10]:continue
            matches=[path for value,path in evidence_origins(old,by_id) if value==native]
            if matches:candidates.append((old,matches))
        if len(candidates)==1:
            item.update(status='copia_demostrada',canonical_id=candidates[0][0]['id'],evidence=candidates[0][1]+['native source id + full annotation + date + same tenant/process'])
        elif len(candidates)>1:
            item['evidence']=['multiple older active native/content owners'];item['candidate_ids']=[c[0]['id'] for c in candidates]
        else:
            item.update(status='legitimo',canonical_id=r['id'],evidence=['accredited CPNU native act; no older active row represents this same native identity and full content'])
        out.append(item)
    return out

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--snapshots',type=pathlib.Path,required=True);p.add_argument('--official',type=pathlib.Path,required=True);p.add_argument('--inventory',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
    cases={'j15':('91edd371-6ce7-4427-b837-36058410ab3f','05001400301520240193000'),'j23':('b4037a4d-0dab-422d-a65f-b7172b040fa4','05001400302320250063800'),'family':('ea6a804b-0380-4a22-b257-0ba306b8b044','11001311001320240075200')}
    rows=[];official={}
    for name,(wi,rad) in cases.items():
        rows.extend(x['row'] for x in json.loads((a.snapshots/(name+'.json')).read_text())['rows']);official[wi]=json.loads((a.official/(rad+'-cpnu-source.json')).read_text())['actuacionesTotal']
    result=classify(json.loads(a.inventory.read_text())['records'],rows,official);a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(dict(collections.Counter(x['status'] for x in result))));print('unique canonicals',len({x['canonical_id'] for x in result if x['status']=='copia_demostrada'}))
