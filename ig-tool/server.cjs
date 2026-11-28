'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes,timingSafeEqual}=require('node:crypto');
const {parseProxy}=require('./input.cjs');
const {connectProxy}=require('./proxy.cjs');
const {Runner,MultiRunner}=require('./runner.cjs');
const {ImapMailbox}=require('./imap.cjs');
const {openWithCookie}=require('./browser.cjs');

const ROOT=path.resolve(__dirname,'..');
const PREFS_FILE=path.join(__dirname,'.local','prefs.json');
const STATIC_ALLOWLIST=new Map([
  ['/','index.html'],
  ['/index.html','index.html'],
  ['/styles.css','styles.css'],
  ['/supabase-config.js','supabase-config.js'],
  ['/supabase-store.js','supabase-store.js'],
  ['/favicon.svg','favicon.svg'],
  ['/ig-tool-ui.js','ig-tool-ui.js'],
  ['/ig-tool-ui.css','ig-tool-ui.css'],
  ['/domain-mail.js','domain-mail.js'],
]);
const MIME={
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.svg':'image/svg+xml',
};

function isLoopbackHost(hostHeader){
  if(!hostHeader||typeof hostHeader!=='string')return false;
  const host=hostHeader.split(':')[0].toLowerCase();
  return host==='127.0.0.1'||host==='localhost';
}

function isAllowedOrigin(origin,hostHeader){
  if(!origin)return true;
  try{
    const u=new URL(origin);
    if(u.protocol!=='http:')return false;
    if(!isLoopbackHost(u.hostname))return false;
    return !hostHeader||u.host.toLowerCase()===hostHeader.toLowerCase();
  }catch{return false;}
}

function readJson(req,limit=32768){
  return new Promise((resolve,reject)=>{
    const chunks=[];let size=0;
    req.on('data',c=>{size+=c.length;if(size>limit){reject(Object.assign(Error('Dữ liệu quá lớn.'),{status:413}));req.destroy();}else chunks.push(c);});
    req.on('end',()=>{
      if(!chunks.length)return resolve({});
      try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}
      catch{reject(Object.assign(Error('JSON không hợp lệ.'),{status:400}));}
    });
    req.on('error',()=>reject(Object.assign(Error('Lỗi đọc dữ liệu.'),{status:400})));
  });
}

function sendJson(res,status,data){
  const body=JSON.stringify(data);
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
  });
  res.end(body);
}

function tokensEqual(a,b){
  if(typeof a!=='string'||typeof b!=='string')return false;
  const ba=Buffer.from(a),bb=Buffer.from(b);
  return ba.length===bb.length&&timingSafeEqual(ba,bb);
}

function createToolServer({proxyFactory=connectProxy,runner=new MultiRunner({proxyFactory,keepBrowserOnSuccess:true}),prefsFile=PREFS_FILE}={}){
  const token=randomBytes(24).toString('hex');
  const cookieSessions=new Set();
  const resolveTarget=(jobId)=>{
    if(typeof runner.resolve!=='function')return runner;
    if(!jobId&&runner.jobs?.size===1)return [...runner.jobs.values()][0];
    return runner.resolve(jobId);
  };
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url||'/',`http://${req.headers.host||'127.0.0.1'}`);
      const pathname=url.pathname;
      if(pathname.startsWith('/api/ig-tool/')){
        if(!isLoopbackHost(req.headers.host)||!isAllowedOrigin(req.headers.origin,req.headers.host)){
          return sendJson(res,403,{error:'Nguồn truy cập không được phép.'});
        }
        if(req.method==='GET'&&pathname==='/api/ig-tool/session'){
          if(req.headers['x-ig-tool-client']!=='1'){
            return sendJson(res,403,{error:'Thiếu tiêu đề xác thực client.'});
          }
          return sendJson(res,200,{token});
        }
        if(!tokensEqual(req.headers['x-ig-tool-token'],token)){
          return sendJson(res,401,{error:'Thiếu hoặc sai token phiên.'});
        }
        if(req.method==='GET'&&pathname==='/api/ig-tool/status'){
          return sendJson(res,200,typeof runner.list==='function'?runner.list():runner.status());
        }
        if(req.method==='GET'&&pathname==='/api/ig-tool/mailbox-url'){
          const target=resolveTarget(url.searchParams.get('jobId'));
          return sendJson(res,200,{url:target.mailboxUrl()});
        }
        if(req.method==='GET'&&pathname==='/api/ig-tool/cookies'){
          const target=resolveTarget(url.searchParams.get('jobId'));
          return sendJson(res,200,{cookie:await target.cookies()});
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/proxy'){
          const body=await readJson(req);
          const config=parseProxy(body.proxy||'',body.protocol||'auto');
          if(!config)return sendJson(res,200,{ip:null,protocol:'direct'});
          const controller=new AbortController();
          req.on('close',()=>controller.abort());
          let handle;
          try{
            handle=await proxyFactory(config,{signal:controller.signal});
            return sendJson(res,200,{ip:handle.ip,protocol:handle.protocol});
          }finally{
            await handle?.close().catch(()=>{});
          }
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/start'){
          const body=await readJson(req);
          return sendJson(res,200,runner.start(body));
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/stop'){
          const body=await readJson(req);
          const target=resolveTarget(body.jobId||url.searchParams.get('jobId'));
          return sendJson(res,200,await target.stop());
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/resume'){
          const body=await readJson(req);
          const target=resolveTarget(body.jobId||url.searchParams.get('jobId'));
          target.resume();
          return sendJson(res,200,target.status());
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/email'){
          const body=await readJson(req);
          const target=resolveTarget(body.jobId||url.searchParams.get('jobId'));
          return sendJson(res,200,await target.updateEmail(body.email));
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/otp'){
          const body=await readJson(req);
          const target=resolveTarget(body.jobId||url.searchParams.get('jobId'));
          target.submitOtp(body.code);
          return sendJson(res,200,target.status());
        }
        if(req.method==='GET'&&pathname==='/api/ig-tool/result'){
          const target=resolveTarget(url.searchParams.get('jobId'));
          return sendJson(res,200,target.result());
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/acknowledge'){
          const body=await readJson(req);
          const target=resolveTarget(body.jobId||url.searchParams.get('jobId'));
          return sendJson(res,200,target.acknowledge());
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/enable-2fa'){
          const body=await readJson(req);
          const target=resolveTarget(body.jobId||url.searchParams.get('jobId'));
          return sendJson(res,200,await target.enable2fa());
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/open-cookie'){
          const body=await readJson(req);
          const platform=body.platform==='facebook'?'facebook':'instagram';
          const cookie=String(body.cookie||'').trim();
          const device=body.device==='desktop'?'desktop':'mobile';
          if(!cookie)return sendJson(res,400,{error:'Tài khoản chưa có Cookie.'});
          const cfg=parseProxy(body.proxy||'',body.protocol||'auto');
          const proxyHandle=cfg?await proxyFactory(cfg):null;
          let session;
          session=await openWithCookie({
            platform,
            cookie,
            proxy:proxyHandle?.server,
            device,
            engine:body.device==='mobile-webkit'?'webkit':'chromium',
            onClose:async()=>{
              if(session)cookieSessions.delete(session);
              await proxyHandle?.close().catch(()=>{});
            },
          });
          cookieSessions.add(session);
          return sendJson(res,200,{ok:true});
        }
        if(req.method==='GET'&&pathname==='/api/ig-tool/prefs'){
          if(!prefsFile)return sendJson(res,200,{});
          const raw=await fs.promises.readFile(prefsFile,'utf8').catch(()=>'{}');
          try{return sendJson(res,200,JSON.parse(raw));}catch{return sendJson(res,200,{});}
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/prefs'){
          if(!prefsFile)return sendJson(res,200,{ok:true});
          const body=await readJson(req);
          const allowed={};
          for(const k of ['platform','device','gender','mailMode','zohoDomain','imapUser','imapPass','birthday','proxy','proxyPool','protocol']){
            if(typeof body[k]==='string')allowed[k]=body[k];
          }
          if(typeof body.useProxy==='boolean')allowed.useProxy=body.useProxy;
          await fs.promises.mkdir(path.dirname(prefsFile),{recursive:true});
          await fs.promises.writeFile(prefsFile,JSON.stringify(allowed,null,2),'utf8');
          return sendJson(res,200,{ok:true});
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/check-ig'){
          const body=await readJson(req);
          const username=String(body.username||'').trim().replace(/^@/,'');
          const cookie=String(body.cookie||'').trim();
          if(!username)return sendJson(res,400,{error:'Thiếu username Instagram.'});
          const headers={
            'X-IG-App-ID':'936619743392459',
            'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            ...(cookie?{Cookie:cookie}:{}),
          };
          if(/sessionid=/.test(cookie)){
            try{
              const meRes=await fetch('https://www.instagram.com/api/v1/accounts/current_user/?edit=true',{headers,signal:AbortSignal.timeout(10000)});
              const meJson=await meRes.json().catch(()=>null);
              if(meRes.ok&&meJson?.user?.username){
                return sendJson(res,200,{status:'live',igId:String(meJson.user.pk||meJson.user.id||''),username:meJson.user.username});
              }
              if(meJson?.message==='checkpoint_required')return sendJson(res,200,{status:'unknown',reason:'checkpoint'});
            }catch{}
          }
          try{
            const pRes=await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,{headers,signal:AbortSignal.timeout(10000)});
            const pJson=await pRes.json().catch(()=>null);
            if(pRes.ok&&pJson?.data?.user?.id){
              return sendJson(res,200,{status:'live',igId:String(pJson.data.user.id),username:pJson.data.user.username});
            }
            if(pRes.status===404)return sendJson(res,200,{status:'not_found',reason:'not_found'});
            return sendJson(res,200,{status:'unknown',reason:'upstream_'+pRes.status});
          }catch{
            return sendJson(res,200,{status:'unknown',reason:'network'});
          }
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/imap-test'){
          const body=await readJson(req);
          const user=String(body.user||'').trim();
          const pass=String(body.pass||'');
          const host=String(body.host||'').trim()||undefined;
          if(!user||!pass)return sendJson(res,400,{error:'Thiếu email tổng hoặc App Password Zoho.'});
          const controller=new AbortController();
          req.on('close',()=>controller.abort());
          const box=new ImapMailbox({email:user,imap:{host,port:993,user,pass}},{signal:controller.signal});
          const msgs=await box.fetchRecent(5);
          return sendJson(res,200,{ok:true,count:msgs.length});
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/imap-messages'){
          const body=await readJson(req);
          const user=String(body.user||'').trim();
          const pass=String(body.pass||'');
          const host=String(body.host||'').trim()||undefined;
          const filterEmail=String(body.email||'').trim().toLowerCase();
          if(!user||!pass)return sendJson(res,400,{error:'Thiếu email tổng hoặc App Password Zoho.'});
          const controller=new AbortController();
          req.on('close',()=>controller.abort());
          const box=new ImapMailbox({email:filterEmail||user,imap:{host,port:993,user,pass}},{signal:controller.signal});
          const msgs=await box.fetchRecent(8,{to:filterEmail});
          const filtered=filterEmail?msgs.filter(m=>String(m.to||'').toLowerCase().includes(filterEmail)):msgs;
          return sendJson(res,200,{messages:filtered.slice(-8).reverse().map(m=>({id:m.id,from:m.from,to:m.to,subject:m.subject,created_at:m.created_at,snippet:String(m.body||'').replace(/\s+/g,' ').slice(0,180),body:String(m.body||'').slice(0,8000)}))});
        }
        return sendJson(res,404,{error:'Không tìm thấy API.'});
      }
      if(req.method!=='GET'&&req.method!=='HEAD'){
        res.writeHead(405);return res.end();
      }
      const rel=STATIC_ALLOWLIST.get(pathname);
      if(!rel){res.writeHead(404);return res.end('Not Found');}
      const filePath=path.join(ROOT,rel);
      const data=await fs.promises.readFile(filePath).catch(()=>null);
      if(!data){res.writeHead(404);return res.end('Not Found');}
      const ext=path.extname(rel);
      res.writeHead(200,{
        'Content-Type':MIME[ext]||'application/octet-stream',
        'Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff',
      });
      res.end(req.method==='HEAD'?undefined:data);
    }catch(err){
      sendJson(res,err?.status||400,{error:err?.message||'Yêu cầu không hợp lệ.'});
    }
  });
  const close=async()=>{
    await Promise.all([...cookieSessions].map(s=>s.close().catch(()=>{})));
    cookieSessions.clear();
    if(typeof runner.shutdown==='function')await runner.shutdown().catch(()=>{});
    else await runner.stop().catch(()=>{});
    await new Promise(resolve=>server.close(()=>resolve()));
  };
  return {server,close,runner};
}

if(require.main===module){
  const port=Number(process.env.IG_TOOL_PORT||4312);
  const app=createToolServer();
  app.server.listen(port,'127.0.0.1',()=>{
    const addr=app.server.address();
    console.log(`IG Tool server listening on http://127.0.0.1:${addr.port}`);
  });
  const shutdown=async()=>{await app.close();process.exit(0);};
  process.on('SIGINT',shutdown);
  process.on('SIGTERM',shutdown);
}

module.exports={createToolServer};
