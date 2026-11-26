const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');const Cloud=require('./supabase-store.js');
function harness(){
 const nodes=new Map();
 const element=()=>({style:{},dataset:{},innerHTML:'',textContent:'',hidden:false,open:false,disabled:false,isConnected:true,scrollLeft:0,setAttribute(){},addEventListener(){},querySelector(){return element()},querySelectorAll(){return []},close(){this.open=false},focus(){}});
 const node=s=>{if(!nodes.has(s))nodes.set(s,element());return nodes.get(s)};
 const handlers={};let reads=0;
 const context={document:{querySelector:node,addEventListener:(event,fn)=>handlers[event]=fn,activeElement:{tagName:'BODY'}},localStorage:{getItem(){reads++;return null},setItem(){throw Error('Local resource writes forbidden')}},navigator:{},addEventListener(){},structuredClone,TextEncoder,TextDecoder,Date,URL,AbortSignal,crypto:require('node:crypto').webcrypto,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},location:{hash:'#tai-khoan'},MXHCloud:Cloud};
 let js=[...fs.readFileSync(require('node:path').join(__dirname,'index.html'),'utf8').matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
 js=js.replace('boot();',`globalThis.T={boot,renderMailBody,parseGmailText,loadSession,commit,persistSettings,canWrite,acts,get,openAccount,render,checkAccountLive,igResultPatch,refreshMonitoringState,setupAuth(client){authClient=client},setup(api){cloudApi=api},status(){return {mode,currentUser,memberRole,cloudBusy,cloudError,count:all().length}}};`);
 context.window=context;vm.createContext(context);vm.runInContext(js,context);return {context,t:context.T,nodes,node,handlers,reads:()=>reads};
}
const session={user:{id:'allowed',email:'member@example.com'},access_token:'jwt'};
const snapshot=()=>({resources:[{uid:'181',revision:1,data:{uid:'181',status:'new',sec:{pass:'credential'}}}],meta:[]});

test('mail content is isolated with light colors and scripts disabled',()=>{
 const h=harness();const html=h.t.renderMailBody('<style>body{color:red}</style><table><tr><td>Mail</td></tr></table><script>alert(1)</script>');
 assert.match(html,/class="mail-body-frame"/);assert.match(html,/srcdoc="&lt;!doctype/);assert.match(html,/color-scheme:light/);assert(!html.includes('allow-scripts'));assert(!html.includes('allow-same-origin'));assert(!html.includes('<script>'));
 const text=h.t.renderMailBody('<img src=x>',true);assert.match(text,/&amp;lt;img/);
});
test('inline scripts do not contain literal closing body tags that confuse Live Server',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'index.html'),'utf8');
 for(const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))assert(!/<\/body\s*>/i.test(script[1]),'Live Server would inject reload code into the script');
});

test('Outlook import recognizes both client ID and refresh token orders',()=>{
 const h=harness(),client='12345678-1234-4234-8234-123456789abc',token='synthetic-refresh-token-for-unit-test-only';
 for(const tail of [token+'|'+client,client+'|'+token]){const result=h.t.parseGmailText('test@outlook.com|example-pass|'+tail+'|ghi chú');assert.equal(result[0].clientId,client);assert.equal(result[0].refreshToken,token);assert.equal(result[0].note,'ghi chú');}
 const simple=h.t.parseGmailText('test@hotmail.com|example-pass');assert.equal(simple[0].refreshToken,undefined);
});

test('manual IG Live confirmation persists timestamp and preserves automatic result',async()=>{
 const h=harness(),data=snapshot();Object.assign(data.resources[0].data,{platform:'instagram',status:'dead',igCheck:{status:'unknown',reason:'upstream_404'}});
 let saved;h.t.setup({membership:async()=>'editor',load:async()=>data,apply:async(r)=>{saved=r[0].data;return {resources:[{uid:'181',revision:2}],meta:[{key:'daily',revision:3}]};}});
 await h.t.loadSession(session);await h.t.acts.confirmIgLive('181');
 assert.equal(h.t.get('181').status,'live');assert(saved.igConfirmed.at);assert.equal(saved.igConfirmed.by,'allowed');assert.equal(saved.igCheck.reason,'upstream_404');assert.match(saved.hist[0].m,/Xác nhận Live/);
});
test('viewer cannot manually confirm IG Live',async()=>{
 const h=harness(),data=snapshot();data.resources[0].data.platform='instagram';h.t.setup({membership:async()=>'viewer',load:async()=>data,apply:()=>{throw Error('must not write')}});await h.t.loadSession(session);await h.t.acts.confirmIgLive('181');assert.equal(h.t.get('181').status,'new');
});

test('IG calls use session JWT and unknown result preserves confirmed status',async()=>{
 const h=harness();const data=snapshot();Object.assign(data.resources[0].data,{platform:'instagram',status:'live',igId:'123'});
 h.t.setup({membership:async()=>'editor',load:async()=>data});await h.t.loadSession(session);
 h.context.MXH_SUPABASE={url:'https://example.supabase.co',key:'sb_publishable_public'};
 h.t.setupAuth({auth:{getSession:async()=>({data:{session:{access_token:'user.jwt.token'}}})}});
 h.context.fetch=async(url,opts)=>{assert.equal(opts.headers.Authorization,'Bearer user.jwt.token');assert.equal(JSON.parse(opts.body).igId,'123');return {ok:true,json:async()=>({status:'unknown',reason:'rate_limited'})};};
 const r=await h.t.checkAccountLive(h.t.get('181'));assert.equal(r.status,'unknown');assert.equal(h.t.igResultPatch(r).status,undefined);
});
test('late IG lookup is discarded after signout',async()=>{
 const h=harness();const data=snapshot();data.resources[0].data.platform='instagram';
 h.t.setup({membership:async()=>'editor',load:async()=>data});await h.t.loadSession(session);
 h.context.MXH_SUPABASE={url:'https://example.supabase.co',key:'sb_publishable_public'};
 h.t.setupAuth({auth:{getSession:async()=>({data:{session:{access_token:'user.jwt.token'}}})}});
 let release;h.context.fetch=()=>new Promise(r=>release=r);
 const pending=h.t.checkAccountLive(h.t.get('181'));await Promise.resolve();await h.t.loadSession(null);
 release({ok:true,json:async()=>({status:'live',igId:'123',username:'example'})});
 assert.equal((await pending).stale,true);assert.equal(h.t.status().count,0);
});

test('missing config fails closed instead of exposing local resources',async()=>{
 const h=harness();await h.t.boot();assert.equal(h.t.status().mode,'denied');assert.equal(h.t.status().count,0);assert.equal(h.reads(),3);assert(h.node('#btnAdd').disabled);
});
test('signed-out visitor sees login and no resources or signup form',async()=>{
 const h=harness();await h.t.loadSession(null);assert.equal(h.t.status().mode,'login');assert.match(h.node('#view').innerHTML,/loginForm/);assert(!h.node('#view').innerHTML.includes('signUp'));assert(h.node('#btnImport').disabled);
});
test('authenticated non-member is denied before loading private records',async()=>{
 const h=harness();h.t.setup({membership:async()=>null,load:async()=>{throw Error('must not load')}});await h.t.loadSession(session);assert.equal(h.t.status().mode,'denied');assert.equal(h.t.status().count,0);
});
test('viewer can read but cannot save; eye re-render keeps status disabled',async()=>{
 const h=harness();h.t.setup({membership:async()=>'viewer',load:async()=>snapshot()});await h.t.loadSession(session);assert.equal(h.t.status().mode,'ready');assert.equal(h.t.canWrite(),false);assert.equal(await h.t.commit([{uid:'test'}]),false);h.t.acts.show('181|pass');assert.match(h.node('#tbl').innerHTML,/<select class="state" disabled/);
});
test('editor save waits for server and failed save never mutates visible records',async()=>{
 const h=harness();let release,fail=false;
 const api={membership:async()=>'editor',load:async()=>snapshot(),apply:async(r,m)=>{if(fail)throw Error('offline');await new Promise(resolve=>release=resolve);return {resources:r.map(x=>({uid:x.uid,revision:2})),meta:[{key:'daily',revision:3}]}}};
 h.t.setup(api);await h.t.loadSession(session);
 const pending=h.t.commit([{uid:'181',status:'live'}]);assert(h.t.status().cloudBusy);assert.equal(h.t.get('181').status,'new');release();assert.equal(await pending,true);assert.equal(h.t.get('181').status,'live');
 fail=true;assert.equal(await h.t.commit([{uid:'181',status:'dead'}]),false);assert.equal(h.t.get('181').status,'live');assert(h.t.status().cloudError);assert.equal(h.node('#toast').dataset.type,'error');
});
test('signout clears private records, selection, and dialogs',async()=>{
 const h=harness();h.t.setup({membership:async()=>'admin',load:async()=>snapshot()});await h.t.loadSession(session);h.node('#drawer').open=true;await h.t.loadSession(null);assert.equal(h.t.get('181'),undefined);assert.equal(h.t.status().mode,'login');assert.equal(h.node('#drawer').open,false);assert.equal(h.t.status().memberRole,null);
});
test('late load completion cannot restore data after signout',async()=>{
 const h=harness();let release;
 h.t.setup({membership:async()=>'admin',load:()=>new Promise(r=>release=r)});const pending=h.t.loadSession(session);await new Promise(r=>setImmediate(r));await h.t.loadSession(null);release(snapshot());await pending;assert.equal(h.t.status().mode,'login');assert.equal(h.t.status().count,0);
});
test('late save completion cannot restore data after signout',async()=>{
 const h=harness();let release;
 h.t.setup({membership:async()=>'admin',load:async()=>snapshot(),apply:()=>new Promise(r=>release=r)});await h.t.loadSession(session);const pending=h.t.commit([{uid:'181',status:'live'}]);await h.t.loadSession(null);release({resources:[{uid:'181',revision:2}],meta:[{key:'daily',revision:3}]});assert.equal(await pending,false);assert.equal(h.t.status().count,0);
});
test('settings failures return false so a confirmation dialog remains open',async()=>{
 const h=harness();h.t.setup({membership:async()=>'admin',load:async()=>snapshot(),writeMeta:async()=>{throw Error('offline')}});await h.t.loadSession(session);assert.equal(await h.t.persistSettings({staleDays:8}),false);
});
