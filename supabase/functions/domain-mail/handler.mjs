const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-domain-mail-secret','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
async function inputJson(req){
  const reader=req.body?.getReader();if(!reader)return null;
  let size=0;const parts=[];
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>524288){await reader.cancel();throw Error('body_too_large');}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
function sameSecret(a,b){if(!a||!b)return false;const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);let n=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)n|=(x[i]||0)^(y[i]||0);return n===0;}
export function createDomainMailHandler(env,fetcher=fetch){
  const domain=String(env.MAIL_DOMAIN||'devsepa.id.vn').trim().toLowerCase();
  const validEmail=value=>typeof value==='string'&&value.length<=254&&value.split('@').length===2&&value.endsWith('@'+domain)&&/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9_-])?$/.test(value.split('@')[0])&&!value.includes('..');
  const db=async(path,options={})=>{
    const res=await fetcher(env.SUPABASE_URL+'/rest/v1/'+path,{...options,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(15000)});
    if(!res.ok){if(res.status===409)throw Error('duplicate');throw Error('database_unavailable');}return res.status===204?null:res.json().catch(()=>null);
  };
  return async req=>{
    if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
    if(req.method!=='POST')return json({error:'method_not_allowed'},405);
    try{
      const input=await inputJson(req).catch(()=>null);if(!input||typeof input!=='object')return json({error:'invalid_request'},400);
      if(input.action==='ingest'){
        if(!sameSecret(req.headers.get('X-Domain-Mail-Secret'),env.DOMAIN_MAIL_INGEST_SECRET))return json({error:'unauthorized'},401);
        const email=String(input.email||'').toLowerCase();
        if(!validEmail(email)||typeof input.id!=='string'||!/^[a-f0-9]{64}$/.test(input.id)||typeof input.body!=='string'||input.body.length>131072||typeof input.subject!=='string'||input.subject.length>2000||typeof input.from!=='string'||input.from.length>2000)return json({error:'invalid_message'},400);
        const boxes=await db('mxh_domain_mailboxes?select=email&email=eq.'+encodeURIComponent(email)+'&limit=1');
        if(!boxes?.length)return json({error:'unknown_recipient'},404);
        await db('mxh_domain_messages?on_conflict=recipient,source_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({recipient:email,source_id:input.id,sender:input.from,subject:input.subject,body:input.body,body_type:input.bodyType==='html'?'html':'text'})});
        return json({accepted:true});
      }
      const auth=req.headers.get('Authorization')||'';
      if(!/^Bearer [^.]+\.[^.]+\.[^.]+$/.test(auth))return json({error:'unauthorized'},401);
      const userRes=await fetcher(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:auth},signal:AbortSignal.timeout(10000)});
      if(!userRes.ok)return json({error:'unauthorized'},401);
      const user=await userRes.json();if(!user.id)return json({error:'unauthorized'},401);
      const members=await db('mxh_members?select=role&user_id=eq.'+encodeURIComponent(user.id)+'&limit=1');
      const role=members?.[0]?.role;if(!['viewer','editor','admin'].includes(role))return json({error:'forbidden'},403);
      if(input.action==='list')return json({domain,mailboxes:await db('mxh_domain_mailboxes?select=email,created_at&order=created_at.desc&limit=200')});
      if(input.action==='create'){
        if(role==='viewer')return json({error:'forbidden'},403);
        const local=typeof input.local==='string'?input.local.trim().toLowerCase():'';const email=local+'@'+domain;
        if(!validEmail(email))return json({error:'invalid_alias'},400);
        const rows=await db('mxh_domain_mailboxes',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({email,created_by:user.id})});
        return json({mailbox:rows?.[0]||{email}});
      }
      if(input.action==='messages'){
        const email=String(input.email||'').trim().toLowerCase();if(!validEmail(email))return json({error:'invalid_email'},400);
        if(typeof input.latest==='string'&&input.latest.length<=80){
          const latest=await db('mxh_domain_messages?select=id&recipient=eq.'+encodeURIComponent(email)+'&order=received_at.desc&limit=1');
          if(latest?.[0]?.id===input.latest)return json({unchanged:true});
        }
        return json({messages:await db('mxh_domain_messages?select=id,sender,subject,body,body_type,received_at&recipient=eq.'+encodeURIComponent(email)+'&order=received_at.desc&limit=30')});
      }
      return json({error:'unknown_action'},400);
    }catch(error){return json({error:error.message==='duplicate'?'alias_exists':'service_unavailable'},error.message==='duplicate'?409:503);}
  };
}
