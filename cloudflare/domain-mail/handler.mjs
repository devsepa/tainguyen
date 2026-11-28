export async function receiveEmail(message,env,{parse,fetch:fetcher=fetch}={}){
  let stored=false;
  try{
    if(message.rawSize<=2*1024*1024){
      const raw=await new Response(message.raw).arrayBuffer();
      if(raw.byteLength<=2*1024*1024){
        const mail=await parse(raw);
        const digest=await crypto.subtle.digest('SHA-256',raw);
        const id=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
        const body=String(mail.html||mail.text||'').slice(0,131072);
        const res=await fetcher(env.INGEST_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Domain-Mail-Secret':env.DOMAIN_MAIL_INGEST_SECRET},body:JSON.stringify({action:'ingest',id,email:message.to.toLowerCase(),from:String(message.from).slice(0,2000),subject:String(mail.subject||'').slice(0,2000),body,bodyType:mail.html?'html':'text'}),signal:AbortSignal.timeout(15000)});
        stored=res.ok;
      }
    }
  }catch{/* Preserve the existing Gmail delivery path if parsing or storage fails. */}
  await message.forward(env.FORWARD_TO);
  return {stored};
}
