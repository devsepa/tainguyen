'use strict';
const tls=require('node:tls');
const {selectOtp}=require('./mailbox.cjs');
const {normalizeImapConfig}=require('./input.cjs');
const {simpleParser}=require('mailparser');

async function parseMessage(source,uid){
  const mail=await simpleParser(source,{skipImageLinks:true,skipTextToHtml:true});
  const escapedText=String(mail.text||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])).replace(/\r?\n/g,'<br>');
  return {
    id:String(uid),created_at:mail.date&&Number.isFinite(+mail.date)?mail.date.toISOString():null,
    from:mail.from?.text||'',to:mail.to?.text||'',subject:mail.subject||'',
    body:typeof mail.html==='string'&&mail.html?mail.html:escapedText,
  };
}

function quoteImap(v){
  return '"'+String(v).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
}

function decodeMimeWords(str){
  return String(str||'').replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi,(_,cs,enc,data)=>{
    try{
      if(enc.toUpperCase()==='B')return Buffer.from(data,'base64').toString('utf8');
      const qp=data.replace(/_/g,' ').replace(/=([0-9A-F]{2})/gi,(__,h)=>String.fromCharCode(parseInt(h,16)));
      return Buffer.from(qp,'latin1').toString('utf8');
    }catch{return _;}
  });
}

function decodeBody(raw,headersText){
  const text=String(raw||'');
  if(/Content-Transfer-Encoding:\s*base64/i.test(headersText)){
    try{return Buffer.from(text.replace(/\s+/g,''),'base64').toString('utf8');}catch{}
  }
  if(/Content-Transfer-Encoding:\s*quoted-printable/i.test(headersText)){
    const unfolded=text.replace(/=\r?\n/g,'');
    const bytes=[];
    for(let i=0;i<unfolded.length;i++){
      if(unfolded[i]==='='&&/^[0-9A-F]{2}$/i.test(unfolded.slice(i+1,i+3))){
        bytes.push(parseInt(unfolded.slice(i+1,i+3),16));i+=2;
      }else{
        bytes.push(unfolded.charCodeAt(i)&0xff);
      }
    }
    return Buffer.from(bytes).toString('utf8');
  }
  return text;
}

function parseHeaders(headerBlock){
  const unfolded=String(headerBlock||'').replace(/\r?\n[ \t]+/g,' ');
  const get=(name)=>{
    const m=unfolded.match(new RegExp(`^${name}:\\s*(.+)$`,'im'));
    return m?decodeMimeWords(m[1].trim()):'';
  };
  return {from:get('From'),to:get('To'),subject:get('Subject'),date:get('Date')};
}

class ImapClient{
  constructor({host='imap.zoho.com',port=993,rejectUnauthorized=true,signal}={}){
    this.host=host;this.port=Number(port)||993;this.rejectUnauthorized=rejectUnauthorized;this.signal=signal;
    this.socket=null;this.buffer=Buffer.alloc(0);this.seq=0;this.waiter=null;
    this.pendingReject=null;this.closedError=null;this.abortHandler=null;
  }
  connect(){
    return new Promise((resolve,reject)=>{
      this.signal?.throwIfAborted();
      const sock=tls.connect({host:this.host,port:this.port,servername:this.host,rejectUnauthorized:this.rejectUnauthorized});
      this.socket=sock;
      sock.setTimeout(20000,()=>this.close(Error('Máy chủ IMAP không phản hồi. Hãy thử tải lại hộp thư.')));
      const onAbort=()=>{this.close();reject(Error('aborted'));};
      this.abortHandler=onAbort;
      this.signal?.addEventListener('abort',onAbort,{once:true});
      const onData=chunk=>{
        this.buffer=Buffer.concat([this.buffer,chunk]);
        if(this.waiter)this.waiter();
      };
      const onErr=err=>{
        this.close(Error('Không kết nối được máy chủ IMAP. Hãy kiểm tra kết nối và thử lại.'));
        this.signal?.removeEventListener('abort',onAbort);
        reject(err);
      };
      sock.on('data',onData);
      sock.on('error',onErr);
      sock.once('close',()=>{this.close();reject(this.closedError);});
      sock.once('secureConnect',()=>{
        this.readLine().then(line=>{
          if(!/^\*\s+OK/i.test(line))return reject(Error('IMAP greeting failed'));
          resolve();
        },reject);
      });
    });
  }
  readBytes(n){
    return new Promise((resolve,reject)=>{
      const check=()=>{
        if(this.buffer.length>=n){
          const out=this.buffer.subarray(0,n);
          this.buffer=this.buffer.subarray(n);
          this.waiter=null;
          this.pendingReject=null;
          resolve(out);
        }
      };
      this.waiter=check;
      this.pendingReject=reject;
      check();
      if(this.waiter&&(this.closedError||this.socket?.destroyed))this.close();
    });
  }
  readLine(){
    return new Promise((resolve,reject)=>{
      const check=()=>{
        const idx=this.buffer.indexOf('\n');
        if(idx!==-1){
          const line=this.buffer.subarray(0,idx+1).toString('utf8').replace(/\r?\n$/,'');
          this.buffer=this.buffer.subarray(idx+1);
          this.waiter=null;
          this.pendingReject=null;
          resolve(line);
        }
      };
      this.waiter=check;
      this.pendingReject=reject;
      check();
      if(this.waiter&&(this.closedError||this.socket?.destroyed))this.close();
    });
  }
  async command(cmd){
    const tag=`A${++this.seq}`;
    this.socket.write(`${tag} ${cmd}\r\n`);
    const lines=[];const literals=[];const literalBuffers=[];
    let continuation;
    while(true){
      const line=continuation===undefined?await this.readLine():continuation;
      continuation=undefined;
      const litMatch=line.match(/\{(\d+)\}$/);
      if(litMatch){
        const size=Number(litMatch[1]);
        const buf=await this.readBytes(size);
        literals.push(buf.toString('utf8'));
        literalBuffers.push(buf);
        lines.push(line);
        continuation=await this.readLine();
        continue;
      }
      if(line.startsWith(tag+' ')){
        if(!line.slice(tag.length+1).toUpperCase().startsWith('OK'))throw Error('IMAP_CMD_FAILED: '+line);
        return {lines,literals,literalBuffers};
      }
      lines.push(line);
    }
  }
  close(error=Error('Kết nối IMAP đã đóng. Hãy thử tải lại hộp thư.')){
    this.closedError ||= error;
    const reject=this.pendingReject;this.pendingReject=null;this.waiter=null;
    if(this.abortHandler)this.signal?.removeEventListener('abort',this.abortHandler);
    this.abortHandler=null;
    const socket=this.socket;this.socket=null;
    reject?.(this.closedError);
    try{socket?.destroy();}catch{}
  }
}

class ImapMailbox{
  constructor({email,imap},{signal,clientFactory=options=>new ImapClient(options)}={}){
    this.email=email;
    this.imap={...imap,...normalizeImapConfig(imap)};
    this.signal=signal;
    this.clientFactory=clientFactory;
  }
  async fetchRecent(limit=15,{uidsOnly=false,to=''}={}){
    const client=this.clientFactory({
      host:this.imap.host,
      port:this.imap.port||993,
      rejectUnauthorized:this.imap.rejectUnauthorized!==false,
      signal:this.signal,
    });
    try{
      await client.connect();
      try{
        await client.command(`LOGIN ${quoteImap(this.imap.user)} ${quoteImap(String(this.imap.pass||'').trim())}`);
      }catch(err){
        if(/AUTHENTICATIONFAILED/i.test(err?.message||'')){
          throw Error('Sai tài khoản/App Password IMAP hoặc chưa bật IMAP (Gmail: dùng App Password 16 ký tự; Zoho: bật IMAP trong Cài đặt).');
        }
        throw err;
      }
      await client.command('SELECT INBOX');
      let search;
      if(to){
        search=await client.command(`UID SEARCH TO ${quoteImap(to)}`).catch(()=>null);
      }
      if(!search)search=await client.command('UID SEARCH ALL');
      const searchLine=search.lines.find(l=>l.startsWith('* SEARCH'))||'';
      const uids=searchLine.replace(/^\*\s+SEARCH\s*/i,'').trim().split(/\s+/).filter(Boolean);
      if(uidsOnly){
        await client.command('LOGOUT').catch(()=>{});
        return uids;
      }
      const recent=uids.slice(-limit);
      const out=[];
      for(const uid of recent){
        const res=await client.command(`UID FETCH ${uid} (BODY.PEEK[]<0.32768>)`);
        const source=res.literalBuffers[0];
        if(!source?.length)throw Error('Không đọc được nội dung thư từ máy chủ IMAP.');
        out.push(await parseMessage(source,uid));
      }
      await client.command('LOGOUT').catch(()=>{});
      return out;
    }finally{
      client.close();
    }
  }
  async snapshot(){
    return new Set(await this.fetchRecent(0,{uidsOnly:true}));
  }
  async findOtp(options){
    const msgs=await this.fetchRecent(8,{to:this.email});
    return selectOtp(msgs,{email:this.email,...options});
  }
}

module.exports={ImapMailbox,ImapClient,parseHeaders,decodeBody,parseMessage};
