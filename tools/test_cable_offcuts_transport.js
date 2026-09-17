const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const calls=[];let user={getIdToken:async()=>'test-id-token'},response={ok:true,status:200,json:async()=>({result:{stores:{MOOV:{}}}})};
const context={window:{},firebase:{auth:()=>({currentUser:user}),app:()=>({options:{projectId:'demo-itc'},functions:()=>{throw Error('Messaging must not be loaded');}})},fetch:async(...args)=>{calls.push(args);return response;},AbortController,setTimeout,clearTimeout,TypeError};
vm.createContext(context);vm.runInContext(fs.readFileSync('assets/cable-offcuts-transport.js','utf8'),context);
(async()=>{
 const call=context.window.CableOffcutsTransport.call;
 assert.ok((await call({action:'overview'})).stores.MOOV);
 assert.equal(calls[0][0],'https://europe-west1-demo-itc.cloudfunctions.net/cableOffcuts');
 assert.equal(calls[0][1].headers.Authorization,'Bearer test-id-token');
 assert.deepEqual(JSON.parse(calls[0][1].body),{data:{action:'overview'}});
 response={ok:false,status:404};await assert.rejects(()=>call({}),/activation/);
 response={ok:false,status:403,json:async()=>({error:{message:'Stock non autorisé'}})};await assert.rejects(()=>call({}),/non autorisé/);
 response={ok:true,status:200,json:async()=>({})};await assert.rejects(()=>call({}),/invalide/);
 user=null;await assert.rejects(()=>call({}),/Reconnectez/);
 console.log('PASS: authenticated callable transport independent of messaging; missing backend, permission and malformed response errors.');
})().catch(e=>{console.error(e);process.exitCode=1;});
