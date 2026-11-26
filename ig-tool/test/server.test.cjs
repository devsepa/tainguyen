const http=require('node:http');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createToolServer}=require('../server.cjs');
function rawGet(url,headers){return new Promise((resolve,reject)=>{const req=http.get(url,{headers},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});}
test('local API rejects foreign origins, missing tokens and arbitrary static paths',async t=>{
  const app=createToolServer();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(()=>app.close());const base='http://127.0.0.1:'+app.server.address().port;
  assert.equal((await fetch(base+'/api/ig-tool/session')).status,403);
  assert.equal((await fetch(base+'/api/ig-tool/session',{headers:{'X-IG-Tool-Client':'1',Origin:'https://foreign.example'}})).status,403);
  assert.equal(await rawGet(base+'/api/ig-tool/session',{'X-IG-Tool-Client':'1',Host:'attacker.example'}),403);
  const session=await fetch(base+'/api/ig-tool/session',{headers:{'X-IG-Tool-Client':'1'}});assert.equal(session.status,200);
  const {token}=await session.json();assert(token.length>=32);
  assert.equal((await fetch(base+'/api/ig-tool/status')).status,401);
  assert.equal((await fetch(base+'/api/ig-tool/status',{headers:{'X-IG-Tool-Token':token}})).status,200);
  for(const file of ['/ig-tool/server.cjs','/.git/config','/ig-tool/package-lock.json','/supabase/grant-admin.sql'])assert.equal((await fetch(base+file)).status,404);
  assert.equal((await fetch(base+'/')).status,200);
  const response=await fetch(base+'/api/ig-tool/start',{method:'POST',headers:{'Content-Type':'application/json','X-IG-Tool-Token':token},body:JSON.stringify({password:'sensitive-value'})});
  assert.equal(response.status,400);assert(!(await response.text()).includes('sensitive-value'));
});
test('proxy testing returns diagnostics without secrets and always closes relay',async t=>{
  let closed=0;
  const app=createToolServer({proxyFactory:async()=>({ip:'203.0.113.7',protocol:'http',close:async()=>{closed++}})});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base='http://127.0.0.1:'+app.server.address().port;
  const {token}=await (await fetch(base+'/api/ig-tool/session',{headers:{'X-IG-Tool-Client':'1'}})).json();
  const response=await fetch(base+'/api/ig-tool/proxy',{method:'POST',headers:{'Content-Type':'application/json','X-IG-Tool-Token':token},body:JSON.stringify({proxy:'127.0.0.1:1234:example:secret-value',protocol:'auto'})});
  const body=await response.json();assert.deepEqual(body,{ip:'203.0.113.7',protocol:'http'});assert.equal(closed,1);
});
