'use strict';
const {createHmac}=require('node:crypto');

function decodeBase32(secret){
  const clean=String(secret||'').replace(/[\s=-]/g,'').toUpperCase();
  if(!clean||!/^[A-Z2-7]+$/.test(clean))throw Error('Mã khóa 2FA không hợp lệ.');
  let bits='';
  for(const ch of clean){
    const idx='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch);
    bits+=idx.toString(2).padStart(5,'0');
  }
  const bytes=[];
  for(let i=0;i+8<=bits.length;i+=8){
    bytes.push(parseInt(bits.slice(i,i+8),2));
  }
  return Buffer.from(bytes);
}

function generateTotp(secret,now=Date.now()){
  const key=decodeBase32(secret);
  const counter=Math.floor(now/1000/30);
  const buf=Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter/0x100000000),0);
  buf.writeUInt32BE(counter>>>0,4);
  const hmac=createHmac('sha1',key).update(buf).digest();
  const offset=hmac[hmac.length-1]&0x0f;
  const code=((hmac[offset]&0x7f)<<24)|((hmac[offset+1]&0xff)<<16)|((hmac[offset+2]&0xff)<<8)|(hmac[offset+3]&0xff);
  return String(code%1000000).padStart(6,'0');
}

module.exports={decodeBase32,generateTotp};
