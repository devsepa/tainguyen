'use strict';
const tls=require('node:tls');
const {selectOtp}=require('./mailbox.cjs');

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
  }
  connect(){
    return new Promise((resolve,reject)=>{
      this.signal?.throwIfAborted();
      const sock=tls.connect({host:this.host,port:this.port,servername:this.host,rejectUnauthorized:this.rejectUnauthorized});
      this.socket=sock;
      const onAbort=()=>{this.close();reject(Error('aborted'));};
      this.signal?.addEventListener('abort',onAbort,{once:true});
      const onData=chunk=>{
        this.buffer=Buffer.concat([this.buffer,chunk]);
        if(this.waiter)this.waiter();
      };
      const onErr=err=>{
        this.signal?.removeEventListener('abort',onAbort);
        reject(err);
      };
      sock.on('data',onData);
      sock.once('error',onErr);
      sock.once('secureConnect',()=>{
        sock.removeListener('error',onErr);
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
          resolve(out);
        }
      };
      this.waiter=check;
      check();
      if(this.waiter&&this.socket?.destroyed)reject(Error('IMAP closed'));
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
          resolve(line);
        }
      };
      this.waiter=check;
      check();
      if(this.waiter&&this.socket?.destroyed)reject(Error('IMAP closed'));
    });
  }
  async command(cmd){
    const tag=`A${++this.seq}`;
    this.socket.write(`${tag} ${cmd}\r\n`);
    const lines=[];const literals=[];
    while(true){
      const line=await this.readLine();
      const litMatch=line.match(/\{(\d+)\}$/);
      if(litMatch){
        const size=Number(litMatch[1]);
        const buf=await this.readBytes(size);
        literals.push(buf.toString('utf8'));
        const tail=await this.readLine();
        lines.push(line+'\n'+tail);
        continue;
      }
      if(line.startsWith(tag+' ')){
        if(!line.slice(tag.length+1).toUpperCase().startsWith('OK'))throw Error('IMAP_CMD_FAILED: '+line);
        return {lines,literals};
      }
      lines.push(line);
    }
  }
  close(){
    try{this.socket?.destroy();}catch{}
    this.socket=null;
  }
}

class ImapMailbox{
  constructor({email,imap},{signal}={}){
    this.email=email;
    this.imap=imap;
    this.signal=signal;
  }
  async fetchRecent(limit=15){
    const defaultHost=/@(?:zoho|zohomail)\.com$/i.test(String(this.imap.user||''))?'imap.zoho.com':'imappro.zoho.com';
    const client=new ImapClient({
      host:this.imap.host||defaultHost,
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
          throw Error('Sai tài khoản/App Password Zoho hoặc chưa bật IMAP trong mail.zoho.com (Cài đặt → Tài khoản Thư → Truy cập IMAP).');
        }
        throw err;
      }
      await client.command('SELECT INBOX');
      const search=await client.command('UID SEARCH ALL');
      const searchLine=search.lines.find(l=>l.startsWith('* SEARCH'))||'';
      const uids=searchLine.replace(/^\*\s+SEARCH\s*/i,'').trim().split(/\s+/).filter(Boolean);
      const recent=uids.slice(-limit);
      const out=[];
      for(const uid of recent){
        const res=await client.command(`UID FETCH ${uid} (BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)] BODY.PEEK[TEXT])`);
        const headerBlock=res.literals[0]||'';
        const bodyRaw=res.literals[1]||'';
        const hdr=parseHeaders(headerBlock);
        const created_at=hdr.date?new Date(hdr.date).toISOString():new Date().toISOString();
        out.push({
          id:String(uid),
          created_at,
          from:hdr.from,
          to:hdr.to,
          subject:hdr.subject,
          body:decodeBody(bodyRaw,headerBlock),
        });
      }
      await client.command('LOGOUT').catch(()=>{});
      return out;
    }finally{
      client.close();
    }
  }
  async snapshot(){
    const msgs=await this.fetchRecent(25);
    return new Set(msgs.map(m=>String(m.id)));
  }
  async findOtp(options){
    const msgs=await this.fetchRecent(15);
    return selectOtp(msgs,{email:this.email,...options});
  }
}

module.exports={ImapMailbox,ImapClient,parseHeaders,decodeBody};
