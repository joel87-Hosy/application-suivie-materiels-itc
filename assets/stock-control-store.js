+(function(global){
  'use strict';
  const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const segments=path=>String(path||'').split('/').filter(Boolean);
  const readAt=(root,path)=>segments(path).reduce((value,key)=>value==null?undefined:value[key],root);
  function assignAt(root,path,value,remove=false){
    const parts=segments(path); if(!parts.length)return remove?{}:copy(value);
    let node=root;
    for(const key of parts.slice(0,-1)){if(!node[key]||typeof node[key]!=='object'||Array.isArray(node[key]))node[key]={};node=node[key];}
    if(remove)delete node[parts.at(-1)];else node[parts.at(-1)]=copy(value);
    return root;
  }
  async function getState(client,company,op){
    const {data,error}=await client.from('stock_control_states').select('state').eq('company_id',company).eq('op',op).maybeSingle();
    if(error)throw error;
    return data?.state??null;
  }
  async function mutate(client,company,op,path,change){
    for(let attempt=0;attempt<5;attempt++){
      const expected=await getState(client,company,op);
      const next=change(expected==null?{}:copy(expected));
      if(next===undefined)return {committed:false,value:readAt(expected,path)};
      const {data,error}=await client.rpc('save_stock_control_state',{operator:op,expected_state:expected,next_state:next});
      if(error)throw error;
      if(data===true)return {committed:true,value:readAt(next,path)};
    }
    throw new Error('Le contrôle a été modifié en même temps. Actualisez puis réessayez.');
  }
  class ControlRef{
    constructor(client,company,op,path=''){this.client=client;this.company=company;this.op=op;this.path=path;this.watchers=new Map();this.key=segments(path).at(-1)||null;}
    child(path){return new ControlRef(this.client,this.company,this.op,[this.path,path].filter(Boolean).join('/'));}
    async once(){
      const state=await getState(this.client,this.company,this.op),value=copy(readAt(state,this.path));
      return {val:()=>copy(value),exists:()=>value!==undefined&&value!==null};
    }
    on(event,callback,error){
      if(event!=='value')return;
      let last;
      const poll=async()=>{try{const state=await getState(this.client,this.company,this.op),value=readAt(state,this.path),signature=JSON.stringify(value??null);if(signature!==last){last=signature;callback({val:()=>copy(value)});}}catch(err){error?.(err);}};
      poll();const timer=setInterval(poll,5000);this.watchers.set(callback,timer);
    }
    off(event,callback){const timer=this.watchers.get(callback);if(timer)clearInterval(timer);this.watchers.delete(callback);}
    async set(value){await mutate(this.client,this.company,this.op,this.path,state=>assignAt(state,this.path,value));}
    async update(values){
      await mutate(this.client,this.company,this.op,this.path,state=>{for(const [key,value] of Object.entries(values||{}))assignAt(state,[this.path,key].filter(Boolean).join('/'),value);return state;});
    }
    async remove(){await mutate(this.client,this.company,this.op,this.path,state=>assignAt(state,this.path,null,true));}
    push(value){
      const key=global.crypto?.randomUUID?.()||String(Date.now())+'-'+Math.random().toString(36).slice(2);
      const target=this.child(key);
      if(value!==undefined)return target.set(value).then(()=>({key}));
      return target;
    }
    async transaction(update){
      let current,committed=false;
      const result=await mutate(this.client,this.company,this.op,this.path,state=>{
        current=copy(readAt(state,this.path)??null);
        const next=update(copy(current));
        if(next===undefined)return undefined;
        committed=true;return assignAt(state,this.path,next);
      });
      committed=committed&&result.committed;
      const value=committed?result.value:current;
      return {committed,snapshot:{val:()=>copy(value)}};
    }
  }
  global.StockControlStore={ref:(company,op,path='',client=global.ITCSupabaseConfig?.client)=>{if(!client)throw new Error('Connexion Supabase indisponible.');return new ControlRef(client,company,op,path);}};
})(window);
