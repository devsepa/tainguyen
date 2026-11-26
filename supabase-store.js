/* Browser-safe Supabase Data API adapter. No credentials or user data live here. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MXHCloud=api;
})(globalThis,function(){
  'use strict';
  const clone=typeof globalThis.structuredClone==='function'?globalThis.structuredClone:v=>JSON.parse(JSON.stringify(v));
  function create({url,key,fetch:fetcher=globalThis.fetch,getToken=async()=>null,pageSize=1000}){
    const project=new URL(url);
    if(project.protocol!=='https:'||!project.hostname.endsWith('.supabase.co')||project.username||project.password||project.pathname!=='/'||project.search||project.hash)throw Error('Invalid Supabase project URL');
    if(typeof key!=='string'||!key||key.startsWith('sb_secret_'))throw Error('Only publishable or anon keys are allowed');
    if(!key.startsWith('sb_publishable_')){
      try{
        const encoded=key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
        const payload=JSON.parse(globalThis.atob(encoded));
        if(payload.role!=='anon')throw Error('Invalid key role');
      }catch{throw Error('Only publishable or anon keys are allowed')}
    }
    if(!Number.isInteger(pageSize)||pageSize<1||pageSize>1000)throw Error('Invalid page size');
    const base=project.origin+'/rest/v1/';
    async function request(path,body){
      const token=await getToken();
      const headers={apikey:key,'Content-Type':'application/json'};
      if(token)headers.Authorization='Bearer '+token;
      else if(!key.startsWith('sb_publishable_'))headers.Authorization='Bearer '+key;
      const ac=typeof AbortController==='function'?new AbortController():null;
      const timer=ac?setTimeout(()=>ac.abort(),30000):0;
      const options={method:body===undefined?'GET':'POST',headers,cache:'no-store'};
      if(ac)options.signal=ac.signal;
      if(body!==undefined)options.body=JSON.stringify(body);
      let response;
      try{response=await fetcher(base+path,options)}finally{if(timer)clearTimeout(timer)}
      let data;try{data=await response.json()}catch{throw Object.assign(Error('Invalid database response'),{status:response.status})}
      if(!response.ok)throw Object.assign(Error(data?.message||'Database request failed'),{code:data?.code,status:response.status});
      return data;
    }
    async function rows(table,id){
      const result=[];let cursor=null;
      for(;;){
        const params=new URLSearchParams({select:'*',order:id+'.asc',limit:String(pageSize)});
        if(cursor!==null)params.set(id,'gt.'+cursor);
        const page=await request(table+'?'+params);
        if(!Array.isArray(page))throw Error('Invalid database rows');
        result.push(...page);
        if(page.length<pageSize)break;
        const next=page[page.length-1][id];
        if(typeof next!=='string'||next===cursor)throw Error('Invalid pagination cursor');
        cursor=next;
      }
      return result;
    }
    async function apply(resource_changes,meta_changes){
      return request('rpc/mxh_apply',{resource_changes,meta_changes});
    }
    return {
      async load(){
        // Resource pages are sequential for stable keyset pagination.
        const resources=await rows('mxh_resources','uid');
        const meta=await rows('mxh_meta','key');
        return {resources,meta};
      },
      async membership(userId){
        const params=new URLSearchParams({select:'role',user_id:'eq.'+userId,limit:'1'});
        const result=await request('mxh_members?'+params);
        return result[0]?.role||null;
      },
      apply,
      writeResources:changes=>apply(changes,[]),
      writeMeta:change=>apply([],[change])
    };
  }
  function workspace(api){
    let resources=new Map(),meta=new Map();
    function state(){return clone({resources:[...resources.values()],meta:[...meta.values()]})}
    return {
      state,
      async load(){
        const snapshot=await api.load();
        resources=new Map(snapshot.resources.map(row=>[row.uid,row]));
        meta=new Map(snapshot.meta.map(row=>[row.key,row]));
        return state();
      },
      async commit(put,del,day){
        const changes=new Map();
        for(const uid of del)if(resources.has(uid))changes.set(uid,{uid,expected:resources.get(uid).revision,data:null});
        for(const data of put)changes.set(data.uid,{uid:data.uid,expected:resources.get(data.uid)?.revision??null,data:clone(data)});
        const rows=[...changes.values()];let committed=0;
        try{
          for(let i=0;i<rows.length;i+=1000){
            const batch=rows.slice(i,i+1000);
            // Counts are computed by SQL from the actual committed rows, not a stale browser snapshot.
            const result=await api.apply(batch,[{key:'daily',expected:meta.get('daily')?.revision??null,data:{day}}]);
            const versions=new Map(result.resources.map(row=>[row.uid,row.revision]));
            for(const change of batch){
              if(change.data===null)resources.delete(change.uid);
              else resources.set(change.uid,{uid:change.uid,data:change.data,revision:versions.get(change.uid)});
            }
            const summary=result.meta.find(row=>row.key==='daily');
            meta.set('daily',{key:'daily',data:summary.data,revision:summary.revision});
            committed+=batch.length;
          }
        }catch(error){error.committed=committed;throw error}
        return state();
      },
      async settings(data){
        const payload=clone(data);
        const result=await api.writeMeta({key:'settings',expected:meta.get('settings')?.revision??null,data:payload});
        meta.set('settings',{key:'settings',data:payload,revision:result.meta[0].revision});
        return state();
      }
    };
  }
  return {create,workspace};
});
