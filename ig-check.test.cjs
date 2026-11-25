const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const load=()=>import(pathToFileURL(path.join(__dirname,'supabase/functions/check-ig/checker.mjs')));
const json=(user)=>new Response(JSON.stringify({data:{user}}),{headers:{'Content-Type':'application/json'}});
test('404 does not mark an account dead or prove it missing',async()=>{const {checkInstagram}=await load();const r=await checkInstagram({username:'example'},async()=>new Response('',{status:404}));assert.equal(r.status,'unknown');assert.equal(r.reason,'upstream_404');});
test('generic HTML and og:title do not prove a profile exists',async()=>{const {checkInstagram}=await load();const r=await checkInstagram({username:'example'},async()=>new Response('<meta property="og:title" content="Instagram">'));assert.equal(r.status,'unknown');});
test('username resolution returns stable identity',async()=>{const {checkInstagram}=await load();const r=await checkInstagram({username:'@Example'},async()=>json({id:'123',username:'example'}));assert.equal(r.status,'live');assert.equal(r.igId,'123');assert.equal(r.username,'example');});
test('a reused username cannot replace stored identity',async()=>{const {checkInstagram}=await load();const r=await checkInstagram({username:'old',igId:'123'},async()=>json({id:'999',pk:'999',username:'old'}));assert.equal(r.status,'unknown');assert.equal(r.reason,'identity_mismatch');assert.equal(r.igId,undefined);});
test('UID lookup verifies renamed profile',async()=>{const {checkInstagram}=await load();const r=await checkInstagram({username:'old',igId:'123'},async(url)=>{assert.match(url,/123\/info/);return new Response(JSON.stringify({user:{pk:'123',username:'new_name'}}));});assert.equal(r.status,'live');assert.equal(r.username,'new_name');});
test('network failure and rate limit stay unknown',async()=>{const {checkInstagram}=await load();assert.equal((await checkInstagram({username:'example'},async()=>{throw Error('network')})).status,'unknown');assert.equal((await checkInstagram({username:'example'},async()=>new Response('',{status:429}))).status,'unknown');});
test('invalid input is unknown without fetching',async()=>{const {checkInstagram}=await load();assert.equal((await checkInstagram({username:'invalid/name'},()=>{throw Error('must not fetch')})).reason,'invalid_username');});
test('unknown results preserve confirmed status and identity',async()=>{const {instagramPatch}=await load();const p=instagramPatch({status:'live',igId:'123'},{status:'unknown',reason:'rate_limited'});assert.equal(p.status,undefined);assert.equal(p.igId,undefined);assert.equal(p.igCheck.reason,'rate_limited');});
test('handler rejects public keys and users without edit membership',async()=>{
 const {createHandler}=await import(pathToFileURL(path.join(__dirname,'supabase/functions/check-ig/handler.mjs')));
 let calls=0;const h=createHandler({SUPABASE_URL:'https://example.supabase.co'},async(url)=>{calls++;return url.includes('/auth/')?new Response('{"id":"u"}'):new Response('[{"role":"viewer"}]');});
 assert.equal((await h(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer sb_publishable_public'}}))).status,401);assert.equal(calls,0);
 assert.equal((await h(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer a.b.c'}}))).status,403);
 assert.equal((await h(new Request('https://test',{method:'OPTIONS'}))).status,200);
});
test('scheduled scanner verifies token, preserves status and writes with expected revision',async()=>{
 const {createHandler}=await import(pathToFileURL(path.join(__dirname,'supabase/functions/check-ig/handler.mjs')));
 let saved;
 const h=createHandler({SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server'},async(url,opts)=>{
   if(url.endsWith('mxh_verify_ig_scan_token'))return new Response('true');
   if(url.endsWith('mxh_ig_scan_queue'))return new Response(JSON.stringify([{uid:'old',revision:42,data:{uid:'old',platform:'instagram',status:'live'}}]));
   if(url.endsWith('mxh_save_ig_check')){saved=JSON.parse(opts.body);return new Response('true');}
   return new Response('',{status:429});
 });
 const res=await h(new Request('https://test',{method:'POST',headers:{'x-scan-token':'token'}}));
 assert.equal(res.status,200);assert.deepEqual(await res.json(),{checked:1,conflicts:0});assert.equal(saved.expected_revision,42);assert.equal(saved.patch.status,undefined);assert.equal(saved.patch.igCheck.reason,'rate_limited');
});
test('explicit missing user has a separate result',async()=>{const {checkInstagram}=await load();assert.equal((await checkInstagram({username:'example'},async()=>json(null))).status,'not_found');});
