import {checkInstagram, instagramPatch} from './checker.mjs';
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type,x-scan-token','Access-Control-Allow-Methods':'POST,OPTIONS'};
export function createHandler(env, fetcher = fetch) {
  const reply = (body, status=200) => new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
  async function db(path, options={}) {
    return fetcher(env.SUPABASE_URL+'/rest/v1/'+path,{...options,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(10000)});
  }
  return async(req) => {
    if (req.method === 'OPTIONS') return new Response('ok',{headers:cors});
    if (req.method !== 'POST') return reply({error:'method_not_allowed'},405);
    try {
      const scanToken=req.headers.get('x-scan-token');
      if (scanToken) {
        const verified=await db('rpc/mxh_verify_ig_scan_token',{method:'POST',body:JSON.stringify({candidate:scanToken})});
        if (!verified.ok || await verified.json() !== true) return reply({error:'unauthorized'},401);
        const queue=await db('rpc/mxh_ig_scan_queue',{method:'POST',body:'{}'});
        if (!queue.ok) return reply({error:'queue_unavailable'},503);
        let checked=0,conflicts=0;
        for (const row of await queue.json()) {
          const a=row.data;
          const result=await checkInstagram({username:a.igUsername || a.uid,igId:a.igId},fetcher);
          const patch=instagramPatch(a,result);
          const written=await db('rpc/mxh_save_ig_check',{method:'POST',body:JSON.stringify({resource_uid:row.uid,expected_revision:row.revision,patch})});
          if (!written.ok) return reply({error:'save_failed',checked},503);
          if (await written.json() === true) checked++; else conflicts++;
        }
        return reply({checked,conflicts});
      }
      const authorization=req.headers.get('Authorization') || '';
      if (!authorization.startsWith('Bearer ') || authorization.slice(7).split('.').length !== 3) return reply({error:'unauthorized'},401);
      const userResponse=await fetcher(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:authorization},signal:AbortSignal.timeout(10000)});
      if (!userResponse.ok) return reply({error:'unauthorized'},401);
      const user=await userResponse.json();
      if (!user.id) return reply({error:'unauthorized'},401);
      const member=await fetcher(env.SUPABASE_URL+'/rest/v1/mxh_members?select=role&user_id=eq.'+encodeURIComponent(user.id),{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:authorization},signal:AbortSignal.timeout(10000)});
      if (!member.ok || !(await member.json()).some(m=>['editor','admin'].includes(m.role))) return reply({error:'forbidden'},403);
      const input=await req.json().catch(()=>null);
      if (!input || typeof input !== 'object') return reply({error:'invalid_request'},400);
      const result=await checkInstagram(input,fetcher);
      return reply({...result,checkedAt:new Date().toISOString()});
    } catch { return reply({status:'unknown',reason:'service_unavailable'},503); }
  };
}
