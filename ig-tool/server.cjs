'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes,timingSafeEqual}=require('node:crypto');
const {parseProxy}=require('./input.cjs');
const {connectProxy}=require('./proxy.cjs');
const {Runner}=require('./runner.cjs');
const {ImapMailbox}=require('./imap.cjs');

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

function createToolServer({proxyFactory=connectProxy,runner=new Runner({proxyFactory,keepBrowserOnSuccess:true}),prefsFile=PREFS_FILE}={}){
  const token=randomBytes(24).toString('hex');
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
          return sendJson(res,200,runner.status());
        }
        if(req.method==='GET'&&pathname==='/api/ig-tool/mailbox-url'){
          return sendJson(res,200,{url:runner.mailboxUrl()});
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
          return sendJson(res,200,await runner.stop());
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/resume'){
          runner.resume();
          return sendJson(res,200,runner.status());
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/email'){
          const body=await readJson(req);
          return sendJson(res,200,await runner.updateEmail(body.email));
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/otp'){
          const body=await readJson(req);
          runner.submitOtp(body.code);
          return sendJson(res,200,runner.status());
        }
        if(req.method==='GET'&&pathname==='/api/ig-tool/result'){
          return sendJson(res,200,runner.result());
        }
        if(req.method==='POST'&&pathname==='/api/ig-tool/acknowledge'){
          return sendJson(res,200,runner.acknowledge());
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
          for(const k of ['platform','device','gender','mailMode','zohoDomain','imapUser','imapPass','birthday','proxy','protocol']){
            if(typeof body[k]==='string')allowed[k]=body[k];
          }
          await fs.promises.mkdir(path.dirname(prefsFile),{recursive:true});
          await fs.promises.writeFile(prefsFile,JSON.stringify(allowed,null,2),'utf8');
          return sendJson(res,200,{ok:true});
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
          const msgs=await box.fetchRecent(15);
          const filtered=filterEmail?msgs.filter(m=>String(m.to||'').toLowerCase().includes(filterEmail)):msgs;
          return sendJson(res,200,{messages:filtered.slice(-8).reverse().map(m=>({id:m.id,from:m.from,to:m.to,subject:m.subject,created_at:m.created_at,snippet:String(m.body||'').replace(/\s+/g,' ').slice(0,180)}))});
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
    await runner.stop().catch(()=>{});
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
