const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
export function createHotmailHandler(env, fetcher=fetch) {
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
  const fail=(code,error,status)=>reply({code,error},status);
  const cacheRequests=new Map();
  const call=(url,options={})=>fetcher(url,{...options,signal:AbortSignal.timeout(15000)});
  const serverHeaders={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'};
  return async(req)=>{
    if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
    if(req.method!=='POST')return fail('method_not_allowed','Chỉ hỗ trợ POST',405);
    try{
      const authorization=req.headers.get('Authorization') || '';
      if(!authorization.startsWith('Bearer ') || authorization.slice(7).split('.').length!==3)return fail('unauthorized','Hãy đăng nhập lại vào kho',401);
      const headers={apikey:env.SUPABASE_ANON_KEY,Authorization:authorization};
      const user=await call(env.SUPABASE_URL+'/auth/v1/user',{headers});
      if(!user.ok)return fail('unauthorized','Phiên đăng nhập đã hết hạn',401);
      const identity=await user.json();
      if(!identity.id)return fail('unauthorized','Phiên đăng nhập không hợp lệ',401);
      const membership=await call(env.SUPABASE_URL+'/rest/v1/mxh_members?select=role&user_id=eq.'+encodeURIComponent(identity.id),{headers});
      if(!membership.ok || !(await membership.json()).some(m=>['viewer','editor','admin'].includes(m.role)))return fail('forbidden','Bạn chưa được cấp quyền vào kho',403);
      const input=await req.json().catch(()=>null);
      if(typeof input?.uid!=='string' || !/^[A-Za-z0-9._-]{1,60}$/.test(input.uid))return fail('invalid_request','Thiếu mã hòm thư hợp lệ',400);
      // Fetch with the caller's JWT so database RLS remains the authority.
      const resource=await call(env.SUPABASE_URL+'/rest/v1/mxh_resources?select=data&uid=eq.'+encodeURIComponent(input.uid),{headers});
      const rows=resource.ok?await resource.json():[];
      const account=rows[0]?.data;
      if(!account || account.platform!=='gmail')return fail('not_found','Không có quyền đọc hòm thư này',404);
      const sec=account.sec;
      if(!sec || typeof sec!=='object' || !sec.refreshToken || !sec.clientId)return fail('oauth_required','Hòm thư cần refresh_token và client_id có quyền Microsoft Graph Mail.Read. Chỉ email và mật khẩu chưa đọc được thư.',409);
      const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sec.clientId+'\n'+sec.refreshToken)))).map(v=>v.toString(16).padStart(2,'0')).join('');
      const cacheKey=input.uid+':'+fingerprint;
      const pending=cacheRequests.get(cacheKey);
      if(pending && Date.now()-pending.at<5000){const x=await pending.promise;return new Response(x.body,{status:x.status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});}
      const promise=(async()=>{
      const cacheUrl=env.SUPABASE_URL+'/rest/v1/mxh_outlook_tokens';
      const cacheRes=await call(cacheUrl+'?select=*&resource_uid=eq.'+encodeURIComponent(input.uid),{headers:serverHeaders});
      if(!cacheRes.ok)return fail('token_storage_unavailable','Không truy cập được kho token Outlook',503);
      const cachedRows=await cacheRes.json();
      let cached=cachedRows.find(r=>r.source_hash===fingerprint);
      let access=cached?.access_token;
      async function renewAccess(){
        const tokenRes=await call('https://login.microsoftonline.com/common/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:String(sec.clientId),refresh_token:cached?.refresh_token || String(sec.refreshToken),grant_type:'refresh_token',scope:'https://graph.microsoft.com/Mail.Read offline_access'})});
        const token=await tokenRes.json().catch(()=>({}));
        if(!tokenRes.ok || !token.access_token){
          if(token.error==='invalid_grant')return fail('reconnect_required','Quyền Microsoft đã hết hạn hoặc bị thu hồi. Cần cấp quyền / nhập lại token OAuth.',409);
          if(token.error==='invalid_scope' || token.error==='consent_required')return fail('graph_permission_required','Token chưa được cấp quyền Microsoft Graph Mail.Read. Token chỉ có quyền IMAP chưa dùng được ở đây.',409);
          if(token.error==='invalid_client')return fail('invalid_client','Client ID không hợp lệ hoặc ứng dụng yêu cầu cấu hình OAuth riêng.',409);
          return fail('microsoft_auth_failed','Microsoft chưa cấp được quyền truy cập. Kiểm tra token, Client ID và quyền Mail.Read.',502);
        }
        access=token.access_token;
        const stored=await call(cacheUrl+'?on_conflict=resource_uid',{method:'POST',headers:{...serverHeaders,Prefer:'resolution=merge-duplicates'},body:JSON.stringify({resource_uid:input.uid,source_hash:fingerprint,refresh_token:token.refresh_token || cached?.refresh_token || sec.refreshToken,access_token:access,expires_at:new Date(Date.now()+Math.max(60,Number(token.expires_in)||3600)*1000).toISOString()})});
        if(!stored.ok)return fail('token_storage_failed','Không lưu được phiên Outlook mới; hãy thử lại',503);
        cached={...cached,refresh_token:token.refresh_token || cached?.refresh_token || sec.refreshToken};
        return null;
      }
      if(!access || !Number.isFinite(Date.parse(cached?.expires_at)) || Date.parse(cached.expires_at)<Date.now()+60000){const error=await renewAccess();if(error)return error;}
        const loadMessages=()=>call('https://graph.microsoft.com/v1.0/me/messages?$top=20&$select=id,subject,from,receivedDateTime,body,bodyPreview&$orderby=receivedDateTime%20desc',{headers:{Authorization:'Bearer '+access,Accept:'application/json',Prefer:'outlook.body-content-type="text"'}});
        let res=await loadMessages();
        if(res.status===401){const error=await renewAccess();if(error)return error;res=await loadMessages();}
        if(res.status===429)return fail('rate_limited','Microsoft đang giới hạn truy cập. Chờ một lát rồi tải lại.',429);
        if(res.status===401)return fail('reconnect_required','Phiên Outlook không còn hợp lệ; cần kết nối lại.',409);
        if(res.status===403)return fail('graph_permission_required','Ứng dụng chưa có quyền đọc nội dung thư Microsoft Graph Mail.Read.',403);
        if(!res.ok)return fail('graph_unavailable','Không tải được thư từ Microsoft. Hãy thử lại.',502);
        const data=await res.json();
        if(!Array.isArray(data.value))return fail('invalid_response','Microsoft trả về dữ liệu không hợp lệ',502);
        return reply({messages:data.value.map(m=>({id:String(m.id||''),subject:String(m.subject||'(Không có tiêu đề)'),from:m.from?.emailAddress?.address || m.from?.emailAddress?.name || '',body:String(m.body?.content || m.bodyPreview || ''),created_at:String(m.receivedDateTime||'')}))});
      })();
      // Cache data rather than a consumed Response stream.
      const reusable=promise.then(async r=>({body:await r.text(),status:r.status}));
      cacheRequests.set(cacheKey,{at:Date.now(),promise:reusable});
      const data=await reusable;
      if(cacheRequests.size>100)cacheRequests.delete(cacheRequests.keys().next().value);
      return new Response(data.body,{status:data.status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
    }catch{return fail('service_unavailable','Kết nối Outlook bị gián đoạn hoặc quá thời gian chờ. Hãy thử lại.',503);}
  };
}
