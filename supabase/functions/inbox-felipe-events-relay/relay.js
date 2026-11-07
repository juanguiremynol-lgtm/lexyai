const sendPinned = (() => {
// Deno native pinned-address transport candidate. This is not deployed.
// Only `sendPinned` is meant for application use; rawPost is exported for local
// TLS tests. It never follows redirects and never resolves again after checking.
const encoder=new TextEncoder(),decoder=new TextDecoder();
function publicV4(ip){
 const parts=ip.split('.');if(parts.length!==4||parts.some(x=>!/^\d{1,3}$/.test(x)||Number(x)>255||String(Number(x))!==x))return false;
 const [a,b,c]=parts.map(Number);return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===192&&b===0&&(c===0||c===2))||(a===192&&b===88&&c===99)||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
}
function validateUrl(raw){
 const u=new URL(raw);
 if(u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443')||!u.hostname.includes('.')||u.hostname==='localhost'||u.hostname.endsWith('.localhost')||/^[0-9.]+$/.test(u.hostname)||u.hostname.includes(':'))throw Error('invalid_destination');
 return u;
}
async function resolvePinned(raw,resolveDns=(name)=>Deno.resolveDns(name,'A')){
 const url=validateUrl(raw);let timer;let addresses;try{addresses=await Promise.race([resolveDns(url.hostname),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('dns_timeout')),5000)})])}finally{clearTimeout(timer)}
 if(!Array.isArray(addresses)||!addresses.length||addresses.some(ip=>!publicV4(ip)))throw Error('unsafe_destination');
 return {url,address:addresses[0]};
}
async function writeAll(conn,bytes){for(let at=0;at<bytes.length;){const n=await conn.write(bytes.subarray(at));if(!n)throw Error('write_failed');at+=n}}
function parseResponse(bytes){
 const raw=decoder.decode(bytes);if(/[^\x00-\x7f]/.test(raw))throw Error('non_ascii_response');const sep=raw.indexOf('\r\n\r\n');if(sep<0||sep>16384)throw Error('invalid_response');
 const lines=raw.slice(0,sep).split('\r\n');const match=/^HTTP\/1\.[01] ([1-5][0-9]{2})(?: |$)/.exec(lines.shift());if(!match)throw Error('invalid_status');
 const headers={};for(const line of lines){const colon=line.indexOf(':');if(colon<1)throw Error('invalid_header');const key=line.slice(0,colon).trim().toLowerCase();const value=line.slice(colon+1).trim();if(headers[key]!==undefined&&['content-length','transfer-encoding','content-encoding'].includes(key))throw Error('duplicate_header');headers[key]=value}
 if(headers['content-encoding']&&headers['content-encoding'].toLowerCase()!=='identity')throw Error('compressed_response');
 const status=Number(match[1]);let body=raw.slice(sep+4);
 if(headers['transfer-encoding']){
  if(headers['transfer-encoding'].toLowerCase()!=='chunked'||headers['content-length'])throw Error('unsupported_transfer_encoding');
  let p=0,out='';for(;;){const end=body.indexOf('\r\n',p);if(end<0)throw Error('invalid_chunk');const nstr=body.slice(p,end).split(';')[0];if(!/^[0-9a-fA-F]{1,8}$/.test(nstr))throw Error('invalid_chunk');const n=parseInt(nstr,16);p=end+2;if(n===0){if(body.slice(p,p+2)!=='\r\n')throw Error('unsupported_trailers');break}if(n>8192||p+n+2>body.length||body.slice(p+n,p+n+2)!=='\r\n')throw Error('invalid_chunk');out+=body.slice(p,p+n);p+=n+2}body=out;
 }else if(headers['content-length']){
  if(!/^\d{1,8}$/.test(headers['content-length'])||Number(headers['content-length'])!==encoder.encode(body).length)throw Error('invalid_length');
 }
 return {status,body};
}
async function rawPost(url,address,headers,body,{port=443,timeoutMs=10000,api=Deno,beforeWrite}={}){
 const payload=encoder.encode(body);if(payload.length>262144)throw Error('payload_too_large');
 const allHeaders={...headers,host:url.hostname,'content-length':String(payload.length),connection:'close','accept-encoding':'identity'};
 for(const [key,value] of Object.entries(allHeaders))if(!/^[a-z0-9-]+$/i.test(key)||/[\r\n]/.test(String(value)))throw Error('invalid_header');
 let tcp,tls,cancelled=false,timer;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{cancelled=true;try{tls?.close()}catch{}try{tcp?.close()}catch{}reject(Error('timeout'))},timeoutMs)});
 try{
  const operation=(async()=>{
   tcp=await api.connect({hostname:address,port,transport:'tcp'});if(cancelled){tcp.close();throw Error('timeout')}
   tls=await api.startTls(tcp,{hostname:url.hostname});tcp=undefined;if(cancelled){tls.close();throw Error('timeout')}
   if(beforeWrite){
    // Deno may defer certificate verification until first I/O. Finish the handshake before spending the single-use grant.
    await tls.handshake();if(cancelled)throw Error('timeout');
    await beforeWrite();if(cancelled)throw Error('timeout');
   }
   const requestHead=`POST ${url.pathname+url.search} HTTP/1.1\r\n`+Object.entries(allHeaders).map(([k,v])=>`${k}: ${v}\r\n`).join('')+'\r\n';
   await writeAll(tls,encoder.encode(requestHead));await writeAll(tls,payload);
   const received=new Uint8Array(32769);let size=0,endOfHeader=-1,framedLength=null;
   for(;;){
    const n=await tls.read(received.subarray(size));if(n===null)break;if(!n)continue;
    size+=n;if(size>32768)throw Error('response_too_large');
    if(endOfHeader<0){
     const head=decoder.decode(received.subarray(0,size));endOfHeader=head.indexOf('\r\n\r\n');
     if(endOfHeader<0){if(size>16384)throw Error('invalid_header');continue}
     const header=head.slice(0,endOfHeader);
     const length=/\r\ncontent-length:\s*([0-9]+)\s*(?:\r\n|$)/i.exec(header);
     if(!/\r\ntransfer-encoding:/i.test(header)){
      if(length)framedLength=Number(length[1]);
      else if(/^HTTP\/1\.[01] (?:204|304)(?: |$)/.test(header.split('\r\n')[0]))framedLength=0;
     }
    }
    if(framedLength!==null&&size>=endOfHeader+4+framedLength)break;
    if(endOfHeader>=0&&framedLength===null){
     const responseText=decoder.decode(received.subarray(0,size));
     if(/\r\ntransfer-encoding:\s*chunked\s*(?:\r\n|$)/i.test(responseText.slice(0,endOfHeader))&&
       /(?:^|\r\n)0\r\n\r\n$/.test(responseText.slice(endOfHeader+4))){
      try{return parseResponse(received.subarray(0,size))}catch{ /* A terminating sequence may occur within a partial chunk. */ }
     }
    }
   }
   if(cancelled)throw Error('timeout');return parseResponse(received.subarray(0,size));
  })();
  return await Promise.race([operation,timeout]);
 }finally{clearTimeout(timer);try{tls?.close()}catch{}try{tcp?.close()}catch{}}
}
async function sendPinned(raw,headers,body,opts={}){
 const {url,address}=await resolvePinned(raw,opts.resolveDns);return await rawPost(url,address,headers,body,opts);
}

return sendPinned;
})();
const handle = await (async () => {
// Dedicated public-key-only transport. It needs no database, mailbox, judicial provider, or service credentials.


const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const base64url=/^[a-zA-Z0-9_-]+$/;
const decoder=new TextDecoder("utf-8",{fatal:true});
const redeemUrl="https://lex-et-litterae-inbox.lovable.app/api/internal/mcp-events/redeem";
const audience="lex-et-litterae-inbox/mcp-events/relay/v1";

function fromBase64Url(x){
  if(typeof x!=="string"||!base64url.test(x))throw Error("invalid");
  return Uint8Array.from(atob(x.replaceAll("-","+").replaceAll("_","/")), c=>c.charCodeAt(0));
}
function shape(obj,keys){
  return obj && typeof obj==="object" && !Array.isArray(obj) &&
    Object.keys(obj).length===keys.length && keys.every(key=>Object.hasOwn(obj,key));
}
function same(a,b){
  if(typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;
  let delta=0; for(let i=0;i<a.length;i++)delta|=a.charCodeAt(i)^b.charCodeAt(i);
  return delta===0;
}
async function boundedJson(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers.get("content-type")??"")||
    Number(req.headers.get("content-length")??0)>12288 || !req.body)throw Error("invalid");
  const reader=req.body.getReader();let size=0;const blocks=[];
  try {
    for (;;) {
      const {value,done}=await reader.read();if(done)break;size+=value.length;
      if(size>12288){await reader.cancel();throw Error("invalid");}blocks.push(value);
    }
  } finally{reader.releaseLock();}
  const all=new Uint8Array(size);let at=0;for(const b of blocks){all.set(b,at);at+=b.length;}
  return JSON.parse(decoder.decode(all));
}
function validEnvelope(x,now){
  if(!shape(x,["aud","nonce","ticket","iat","exp","url","kind","subscription_id","webhook_id","webhook_timestamp","webhook_signature","body"]))return false;
  if(x.aud!==audience||!uuid.test(x.nonce)||typeof x.ticket!=="string"||!base64url.test(x.ticket)||x.ticket.length!==43)return false;
  if(!Number.isSafeInteger(x.iat)||!Number.isSafeInteger(x.exp)||x.iat>now+3||x.exp<=now||x.exp<=x.iat||x.exp-x.iat>30)return false;
  if(typeof x.url!=="string"||x.url.length>2048||/[\x00-\x20\x7f]/.test(x.url)||
    !/^sub_[a-f0-9]{64}$/.test(x.subscription_id)||!/^\d{10}$/.test(x.webhook_timestamp)||
    Math.abs(Number(x.webhook_timestamp)-x.iat)>30||typeof x.webhook_signature!=="string"||
    !/^v1,[A-Za-z0-9+/]{43}=(?: v1,[A-Za-z0-9+/]{43}=)?$/.test(x.webhook_signature)||
    typeof x.body!=="string"||x.body.length>1024)return false;
  const data=JSON.parse(x.body);
  if(x.kind==="verify")return /^msg_verification_[a-f0-9]{32}$/.test(x.webhook_id) &&
    shape(data,["type","challenge"]) && data.type==="verification" &&
    typeof data.challenge==="string" && /^[a-f0-9]{64}$/.test(data.challenge);
  return x.kind==="deliver" && x.webhook_id.startsWith("evt_") && uuid.test(x.webhook_id.slice(4)) &&
    shape(data,["eventId","name","timestamp","data","cursor"]) && data.eventId===x.webhook_id &&
    data.name==="whatsapp.message_received" && data.cursor===null &&
    typeof data.timestamp==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.timestamp)&&Number.isFinite(Date.parse(data.timestamp))&&
    shape(data.data,["conversation_id","message_id"]) && uuid.test(data.data.conversation_id) && uuid.test(data.data.message_id);
}
async function redeem(x) {
  // Inbox atomically consumes the exact nonce and ticket for its signed text; only HTTP 204 grants one write.
  const r=await fetch(redeemUrl,{method:"POST",redirect:"error",credentials:"omit",cache:"no-store",
    headers:{"content-type":"application/json"},body:JSON.stringify({nonce:x.nonce,ticket:x.ticket}),
    signal:AbortSignal.timeout(3500)});
  await r.body?.cancel();return r.status===204;
}
const reply=(status,state,remoteStatus)=>Response.json({state,...(remoteStatus===undefined?{}:{remote_status:remoteStatus})},
  {status,headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});

function createRelay({verificationKey,consume=redeem,transport=sendPinned,clock=()=>Math.floor(Date.now()/1000)}) {
  return async request=>{
    if(request.method!=="POST")return reply(405,"method");
    let x;
    try {
      const signed=await boundedJson(request);
      if(!shape(signed,["payload","signature"])||typeof signed.payload!=="string"||signed.payload.length>8192)return reply(403,"invalid");
      const bytes=fromBase64Url(signed.payload), sig=fromBase64Url(signed.signature);
      if(sig.length!==64||!await crypto.subtle.verify("Ed25519",verificationKey,sig,bytes))return reply(403,"invalid");
      x=JSON.parse(decoder.decode(bytes));if(!validEnvelope(x,clock()))return reply(403,"invalid");
    } catch{return reply(403,"invalid");}
    const headers={"content-type":"application/json","webhook-id":x.webhook_id,"webhook-timestamp":x.webhook_timestamp,
      "webhook-signature":x.webhook_signature,"x-mcp-subscription-id":x.subscription_id};
    let permitted=false;
    try {
      const result=await transport(x.url,headers,x.body,{beforeWrite:async()=>{
        if(clock()>=x.exp||!await consume(x)||clock()>=x.exp)throw Error("expired");
        permitted=true;
      }});
      if(!permitted)return reply(503,"not_written");
      if(x.kind==="verify"){
        let echo;try{echo=JSON.parse(result.body).challenge;}catch{}
        return result.status>=200&&result.status<300&&same(echo,JSON.parse(x.body).challenge)
          ?reply(200,"verified"):reply(200,"verification_failed");
      }
      return reply(200,"provider_response",result.status);
    } catch{return permitted?reply(200,"unknown"):reply(409,"not_written");}
  };
}

async function loadVerificationKey(raw){
  const bytes=fromBase64Url(raw);if(bytes.length!==32)throw Error("invalid_public_key");
  return crypto.subtle.importKey("raw",bytes,{name:"Ed25519"},false,["verify"]);
}

return createRelay({verificationKey:await loadVerificationKey("Y3lD2RUahYl2ZUoAzPLKKKjk9Lit9yNaIInxZpVEOMo")});
})();
const publicIdentity = "Y3lD2RUahYl2ZUoAzPLKKKjk9Lit9yNaIInxZpVEOMo";
Deno.serve(request => {
  if (request.method === "GET" && new URL(request.url).pathname.endsWith("/health")) {
    return Response.json({protocol:"inbox-events-relay/v1",public_key:publicIdentity},
      {headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});
  }
  return handle(request);
});
