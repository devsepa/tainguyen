// Synthetic layout smoke test using the installed Chrome DevTools protocol.
const fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const server=http.createServer((req,res)=>{
 const file=req.url.split('?')[0]==='/styles.css'?'styles.css':'index.html';let data=fs.readFileSync(path.join(__dirname,file),'utf8');
 if(file==='index.html')data=data.replace('boot();',`globalThis.mobileTest={setup(){mode='ready';localMode=true;const a={uid:'mobile_test_user',platform:'instagram',status:'dead',email:'long-email@example.com',sec:{pass:'sample-password'}};shards[hash(a.uid)][a.uid]=a;const m={uid:'mobile_mail',platform:'gmail',email:'long-mobile-test@example.edu',isEdu:true,status:'live',sec:{pass:'https://tempamail.com/access?key=12345678-1234-4234-8234-123456789abc'},note:'Ghi chú kiểm tra trên điện thoại'};shards[hash(m.uid)][m.uid]=m;render();},render,openAccount,openTempMailInbox};`);
 res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/html');res.end(data);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'mxh-mobile-layout-'));
 const chrome=spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 let ws;
 try{
  const endpoint=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Chrome startup timed out')),15000);chrome.on('error',reject);chrome.stderr.on('data',b=>{output+=b;const m=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
  ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('DevTools connection timed out')),10000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});ws.addEventListener('error',()=>reject(Error('DevTools WebSocket failed')),{once:true});});
  let id=0;const pending=new Map();ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>reject(Error('DevTools timeout: '+method)),10000);pending.set(n,{resolve:r=>{clearTimeout(timer);resolve(r)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id:n,method,params,sessionId}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const call=(m,p)=>send(m,p,sessionId);
  const evaluate=async(expression)=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await call('Network.enable');await call('Network.setBlockedURLs',{urls:['*supabase.co*','*googleapis.com*','*gstatic.com*','*cdn.jsdelivr.net*']});
  for(const [width,height] of [[320,640],[390,844],[760,650],[844,390],[1440,900]]){
   await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<=760});
   await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/#tai-khoan'});
   for(let n=0;n<50;n++){if(await evaluate('typeof mobileTest!=="undefined"'))break;await new Promise(r=>setTimeout(r,100));}
   await evaluate('location.hash="tai-khoan";mobileTest.setup()');
   const layout=await evaluate(`({width:document.documentElement.scrollWidth,viewport:innerWidth,table:document.querySelector('.tablewrap')?.getBoundingClientRect().width,confirm:!!document.querySelector('[data-act="confirmIgLive"]')})`);
   assert(layout.confirm,await evaluate('document.body.innerText'));assert(layout.width<=width+1,JSON.stringify({width,...layout}));
   if(width<=760) assert(await evaluate(`document.querySelector('.mobile-cards').scrollWidth <= document.querySelector('.mobile-cards').clientWidth+1`),'Account cards overflow');
   await evaluate(`document.querySelector('.tablewrap').scrollLeft=99999;mobileTest.openAccount('mobile_test_user');`);
   const rect=await evaluate(`(()=>{const b=document.querySelector('#drawer .actions button:last-child');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
   assert(rect.x>=0 && rect.x+rect.width<=width+1 && rect.y>=0 && rect.y+rect.height<=height+1,JSON.stringify({width,height,rect}));
   await evaluate(`document.querySelector('#drawer').close();location.hash='gmail';mobileTest.render()`);
   assert(await evaluate(`!!document.querySelector('[data-act="cpMailPass"]')`),'Mail actions missing');
   if(width<=760) {
    const mail=await evaluate(`({page:document.documentElement.scrollWidth,card:document.querySelector('.mobile-cards').scrollWidth,container:document.querySelector('.mobile-cards').clientWidth,cells:[...document.querySelectorAll('.mobile-cards tbody td')].map(td=>({width:td.scrollWidth,visible:td.clientWidth}))})`);
    assert(mail.page<=width+1 && mail.card<=mail.container+1 && mail.cells.every(c=>c.width<=c.visible+1),JSON.stringify({width,mail}));
   }
   await evaluate(`(()=>{window.__testMessages=[{id:'old',subject:'Old OTP 123456',body:'OTP 123456',created_at:'2026-11-26T00:00:00Z'}];window.fetch=async url=>({json:async()=>String(url).includes('/manage')?{client:{uuid:'test'}}:{messages:window.__testMessages}});window.__popupTimers=[];const originalTimer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>{if(ms===7000){window.__popupTimers.push(fn);return 0;}return originalTimer(fn,ms,...args)};mobileTest.openTempMailInbox('mobile_mail')})()`);
   await evaluate(`new Promise(r=>setTimeout(r,50))`);
   assert(await evaluate(`document.querySelector('#mailNotifStack').children.length===0 && !document.querySelector('.inbox-message--new')`),'Opening old mail must not notify or highlight');
   await evaluate(`(()=>{window.__testMessages=[{id:'new',subject:'New OTP 654321',body:'OTP 654321',created_at:'2026-11-26T01:00:00Z'},...window.__testMessages];document.querySelector('#btnRefreshInbox').click()})()`);
   await evaluate(`new Promise(r=>setTimeout(r,50))`);
   assert(await evaluate(`document.querySelectorAll('.inbox-message--new').length===1`),'Only incoming mail gets highlighted');
   if(width>760){assert(await evaluate(`document.querySelector('#mailNotifStack').children.length===1`),'New mail popup missing');await evaluate(`window.__popupTimers.forEach(fn=>fn());window.__popupTimers=[]`);assert(await evaluate(`document.querySelector('#mailNotifStack').children.length===0`),'Popup must expire after 7 seconds');}
   await evaluate(`document.querySelector('#btnRefreshInbox').click()`);await evaluate(`new Promise(r=>setTimeout(r,50))`);
   assert(await evaluate(`document.querySelector('#mailNotifStack').children.length===0`),'Same mail must not notify twice');
   const inbox=await evaluate(`(()=>{const b=document.querySelector('#btnRefreshInbox');const d=document.querySelector('#dlg');return {exists:!!b,overflow:d.scrollWidth>d.clientWidth+1,button:b?b.getBoundingClientRect().width:0}})()`);
   assert(inbox.exists && !inbox.overflow && inbox.button>=50,JSON.stringify({width,inbox}));
   const backdrop=await evaluate(`(()=>{const r=document.querySelector('#dlg').getBoundingClientRect();return r.top>2?{x:innerWidth/2,y:r.top/2}:{x:Math.max(0,r.left/2),y:innerHeight/2}})()`);
   await call('Input.dispatchMouseEvent',{type:'mousePressed',...backdrop,button:'left',clickCount:1});
   await call('Input.dispatchMouseEvent',{type:'mouseReleased',...backdrop,button:'left',clickCount:1});
   assert(await evaluate(`!document.querySelector('#dlg').open`),'Backdrop tap must close inbox');
   console.log('PASS account, mail and inbox layout '+width+'x'+height);
  }
 }finally{if(ws)ws.close();chrome.kill();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
