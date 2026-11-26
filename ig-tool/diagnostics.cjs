'use strict';

const KNOWN_ERRORS=new Set(['invalid_code','incorrect_code','invalid_confirmation_code','invalid_nonce','code_expired','expired_code','session_expired','login_required','challenge_required','rate_limit_error','too_many_requests','sentry_block','signup_block','feedback_required','email_not_valid','email_taken','registration_required','csrf_failed','invalid_csrf_token']);

function registrationStage(path){
  if(/(?:send|resend).*(?:email|code|confirm)|(?:email|code|confirm).*(?:send|resend)/i.test(path))return 'send_code';
  if(/(?:check|confirm|validat|verif).*(?:code|confirmation)|(?:code|confirmation).*(?:check|confirm|validat)/i.test(path))return 'verify_code';
  if(/bloks|signup|registration|web_create|\/accounts\/create/i.test(path))return 'registration';
  return 'other';
}

function summarizeResponse(text){
  const summary={errors:[]};
  if(typeof text!=='string'||text.length>262144)return summary;
  let data;
  try{data=JSON.parse(text.replace(/^\s*for\s*\(\s*;;\s*\)\s*;/,''));}catch{return summary;}
  if(['ok','fail'].includes(data?.status))summary.outcome=data.status;
  const errors=new Set();let remaining=1000;
  const visit=(value,depth,inError=false)=>{
    if(depth>8 || --remaining<0)return;
    if(typeof value==='string'){
      // Only fixed enums may leave this parser. No arbitrary message text,
      // numbers, URLs, tokens, email addresses, or request data are retained.
      if(inError && KNOWN_ERRORS.has(value))errors.add(value);
    }else if(Array.isArray(value))for(const item of value.slice(0,30))visit(item,depth+1,inError);
    else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value).slice(0,50))visit(item,depth+1,/^(error|errors|error_type|error_code)$/.test(key));
  };
  visit(data,0);summary.errors=[...errors];return summary;
}

function observePage(page){
  const events=[];const tracked=new WeakMap();
  const onRequest=request=>{
    if(!['POST','PUT','PATCH'].includes(request.method())||!['xhr','fetch'].includes(request.resourceType()))return;
    let url;
    try{url=new URL(request.url());if(url.origin!==new URL(page.url()).origin)return;}catch{return;}
    const event={at:Date.now(),stage:registrationStage(url.pathname),errors:[]};
    tracked.set(request,event);events.push(event);if(events.length>12)events.shift();
  };
  const onResponse=response=>{
    const event=tracked.get(response.request());if(!event)return;
    event.httpStatus=response.status();event.respondedAt=Date.now();
    const headers=response.headers();
    if(!/json|javascript/i.test(headers['content-type']||'') || Number(headers['content-length']||0)>262144)return;
    response.text().then(text=>Object.assign(event,summarizeResponse(text))).catch(()=>{});
  };
  const onFailed=request=>{const event=tracked.get(request);if(event)event.networkError=true;};
  page.on('request',onRequest);page.on('response',onResponse);page.on('requestfailed',onFailed);
  return {
    snapshot:()=>events.map(event=>({...event,errors:[...event.errors]})),
    detach(){page.off('request',onRequest);page.off('response',onResponse);page.off('requestfailed',onFailed);}
  };
}
module.exports={registrationStage,summarizeResponse,observePage};
