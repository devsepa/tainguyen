'use strict';
const net=require('node:net');
const {Server}=require('proxy-chain');
const {request}=require('playwright');

function upstreamUrl(config, protocol) {
  const auth=config.username ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@` : '';
  return `${protocol}://${auth}${config.host}:${config.port}`;
}

async function connectProxy(config,{signal,probeUrl='https://api64.ipify.org?format=json'}={}) {
  if (!config) return {server:null,protocol:'direct',ip:null,close:async()=>{}};
  const protocols=config.protocol === 'auto' ? ['http','socks5'] : [config.protocol];
  for (const protocol of protocols) {
    signal?.throwIfAborted();
    const relay=new Server({host:'127.0.0.1',port:0,verbose:false,prepareRequestFunction:()=>({upstreamProxyUrl:upstreamUrl(config,protocol)})});
    relay.on('requestFailed',()=>{});
    let context,closed=false;
    const close=async()=>{if(closed)return;closed=true;await context?.dispose().catch(()=>{});await relay.close(true).catch(()=>{});};
    const abort=()=>{void close();};
    signal?.addEventListener('abort',abort,{once:true});
    try {
      await relay.listen();
      signal?.throwIfAborted();
      const server=`http://127.0.0.1:${relay.port}`;
      context=await request.newContext({proxy:{server},timeout:12000});
      const response=await context.get(probeUrl);
      if (!response.ok()) throw Error('probe_failed');
      const body=await response.json();
      if (!net.isIP(body.ip)) throw Error('invalid_ip');
      signal?.throwIfAborted();
      await context.dispose(); context=null;
      signal?.removeEventListener('abort',abort);
      return {server,protocol,ip:body.ip,close};
    } catch {
      signal?.removeEventListener('abort',abort);
      await close();
      signal?.throwIfAborted();
    }
  }
  throw Error('Không kết nối được proxy. Kiểm tra giao thức, tài khoản hoặc hạn sử dụng.');
}
module.exports={connectProxy,upstreamUrl};
