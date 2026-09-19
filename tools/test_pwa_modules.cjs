const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
(async()=>{
 const handlers={},saved=new Map();let network=async()=>new Response('new module'),networkCalls=0;
 const key=request=>typeof request==='string'?request:request.url;
 const context={URL,Response,console,importScripts(){},firebase:{initializeApp(){},messaging:()=>({onBackgroundMessage(){}})},
  self:{location:{origin:'https://app.example'},addEventListener:(name,fn)=>{handlers[name]=fn}},
  fetch:async(request,options)=>{networkCalls++;assert.equal(options?.cache,'no-cache');return network(request)},
  caches:{match:async request=>saved.get(key(request))?.clone(),open:async()=>({put:async(request,response)=>saved.set(key(request),response)})}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('sw.js','utf8'),context);
 const request={url:'https://app.example/assets/supabase-store.js?v=current',method:'GET',mode:'cors'};
 const run=async req=>{let response;handlers.fetch({request:req,respondWith:value=>{response=value}});return response;};
 saved.set(request.url,new Response('stale module'));
 assert.equal(await(await run(request)).text(),'new module','online code comes from network');
 await new Promise(resolve=>setImmediate(resolve));
 network=async()=>{throw Error('Offline')};assert.equal(await(await run(request)).text(),'new module','offline uses last working module');
 network=async()=>new Response('unavailable',{status:503});assert.equal(await(await run(request)).text(),'new module');
 saved.clear();assert.equal((await run(request)).type,'error','never return HTML for a missing script');
 const before=networkCalls;assert.equal(await run({url:'https://tenant.supabase.co/rest/v1/app_records',method:'GET'}),undefined);assert.equal(networkCalls,before,'authenticated API bypasses cache');
 console.log('PASS: current JS replaces stale cache, offline/HTTP-error fallback, missing scripts never receive HTML, authenticated APIs uncached.');
})().catch(e=>{console.error(e);process.exitCode=1});
