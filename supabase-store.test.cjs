const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create,workspace}=require('./supabase-store.js');
const url='https://example.supabase.co',key='sb_publishable_test';
const response=data=>({ok:true,status:200,json:async()=>data});

test('pages beyond the API limit and fetches shared metadata',async()=>{
 const calls=[];
 const cloud=create({url,key,pageSize:2,fetch:async(input,options)=>{
  const u=new URL(input);calls.push({u,options});
  if(u.pathname.endsWith('/mxh_meta'))return response([{key:'settings',data:{staleDays:7},revision:2}]);
  return response(u.searchParams.has('uid')?[{uid:'c',data:{uid:'c'},revision:3}]:[{uid:'a',data:{uid:'a'},revision:1},{uid:'b',data:{uid:'b'},revision:2}]);
 }});
 const data=await cloud.load();assert.equal(data.resources.length,3);assert.equal(data.meta[0].key,'settings');
 assert.equal(calls[1].u.searchParams.get('uid'),'gt.b');assert.equal(calls[0].options.headers.apikey,key);
});
test('passes expected revisions and returns server versions',async()=>{
 let body;
 const cloud=create({url,key,fetch:async(u,o)=>{assert(u.endsWith('/rpc/mxh_apply'));body=JSON.parse(o.body);return response({resources:[{uid:'a',revision:4}],meta:[]})}});
 const changes=[{uid:'a',expected:3,data:{uid:'a',name:'Updated'}}];
 const result=await cloud.writeResources(changes);assert.deepEqual(body,{resource_changes:changes,meta_changes:[]});assert.equal(result.resources[0].revision,4);
});
test('deletion includes expected revision, not a blind delete',async()=>{
 const cloud=create({url,key,fetch:async(u,o)=>{assert.deepEqual(JSON.parse(o.body).resource_changes,[{uid:'a',expected:4,data:null}]);return response({resources:[],meta:[]})}});
 await cloud.writeResources([{uid:'a',expected:4,data:null}]);
});
test('conflicts and failed writes reject instead of reporting saved',async()=>{
 const cloud=create({url,key,fetch:async()=>({ok:false,status:409,json:async()=>({code:'40001',message:'Revision conflict'})})});
 await assert.rejects(cloud.writeResources([{uid:'a',expected:1,data:{uid:'a'}}]),e=>e.code==='40001'&&e.status===409);
});
test('uses a signed-in user token without confusing publishable keys with JWTs',async()=>{
 const cloud=create({url,key,getToken:async()=>'user.jwt.token',fetch:async(u,o)=>{assert.equal(o.headers.Authorization,'Bearer user.jwt.token');return response([])}});
 await cloud.load();
 const anon=create({url,key,fetch:async(u,o)=>{assert.equal(o.headers.Authorization,undefined);return response([])}});
 await anon.load();
});
test('rejects secret/service-role keys and invalid project URLs',()=>{
 for(const bad of ['sb_secret_dont_publish',Buffer.from('{}').toString('base64url')+'.'+Buffer.from('{"role":"service_role"}').toString('base64url')+'.signature'])assert.throws(()=>create({url,key:bad}));
 assert.throws(()=>create({url:'http://example.com',key}));
});
test('network errors reject; metadata writes carry revision checks',async()=>{
 const broken=create({url,key,fetch:async()=>{throw Error('offline')}});await assert.rejects(broken.load(),/offline/);
 const cloud=create({url,key,fetch:async(u,o)=>{assert.deepEqual(JSON.parse(o.body).meta_changes,[{key:'settings',expected:null,data:{staleDays:9}}]);return response({meta:[{key:'settings',revision:1}]})}});
 assert.equal((await cloud.writeMeta({key:'settings',expected:null,data:{staleDays:9}})).meta[0].revision,1);
});

test('workspace publishes records only after the server confirms the transaction',async()=>{
 let release;const wait=new Promise(r=>release=r);let sent;
 const api={load:async()=>({resources:[{uid:'a',revision:1,data:{uid:'a',status:'new'}}],meta:[]}),apply:async(r,m)=>{sent={r,m};await wait;return {resources:[{uid:'a',revision:2}],meta:[{key:'daily',revision:3,data:{days:{'2026-11-25':{live:2}}}}]}}};
 const w=workspace(api);await w.load();const operation=w.commit([{uid:'a',status:'live'}],[],'2026-11-25');
 assert.equal(w.state().resources[0].data.status,'new');release();await operation;
 assert.equal(w.state().resources[0].data.status,'live');assert.equal(sent.r[0].expected,1);assert.deepEqual(sent.m[0].data,{day:'2026-11-25'});assert.equal(w.state().meta[0].data.days['2026-11-25'].live,2);
});
test('workspace does not advance its state after a conflict or failed metadata save',async()=>{
 const api={load:async()=>({resources:[{uid:'a',revision:1,data:{uid:'a'}}],meta:[]}),apply:async()=>{throw Object.assign(Error('conflict'),{code:'40001'})}};
 const w=workspace(api);await w.load();await assert.rejects(w.commit([] ,['a'],'2026-11-25'));assert.equal(w.state().resources.length,1);
 await assert.rejects(w.settings({staleDays:9}));assert.equal(w.state().meta.length,0);
});
test('large imports use batches; partial failures are reported explicitly',async()=>{
 let calls=0;const api={load:async()=>({resources:[],meta:[]}),apply:async(r)=>{if(++calls===2)throw Error('offline');return {resources:r.map((x,i)=>({uid:x.uid,revision:i+1})),meta:[{key:'daily',revision:1001,data:{days:{}}}]}}};
 const w=workspace(api);await w.load();const put=Array.from({length:1001},(_,i)=>({uid:String(i),status:'new'}));
 await assert.rejects(w.commit(put,[],'2026-11-25'),e=>e.committed===1000);
 assert.equal(w.state().resources.length,1000);
});
test('initial membership is explicitly queried rather than assuming empty means allowed',async()=>{
 const cloud=create({url,key,fetch:async(u)=>{const parsed=new URL(u);assert.equal(parsed.pathname,'/rest/v1/mxh_members');assert.equal(parsed.searchParams.get('user_id'),'eq.member-id');return response([{role:'viewer'}])}});
 assert.equal(await cloud.membership('member-id'),'viewer');
});
