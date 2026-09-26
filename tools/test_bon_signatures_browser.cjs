const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict'),{spawn}=require('child_process');
let chrome,ws;const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'itc-signatures-'));
 chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--no-first-run','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let port;for(let i=0;i<100&&!port;i++){try{port=fs.readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{await pause(100)}}
 if(!port)throw Error('Chrome unavailable');
 const targets=await(await fetch('http://127.0.0.1:'+port+'/json')).json();ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let sequence=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}};
 const command=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('Browser timeout')),15000);pending.set(id,m=>{clearTimeout(timer);if(m.error)reject(Error(m.error.message));else resolve(m.result)});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||'Browser exception');return result.result?.value;};
 for(const file of ['assets/bon-reference.js','assets/bon-signatures.js','.tools/report-libs/jspdf.js','.tools/report-libs/autotable.js'])await evaluate(fs.readFileSync(file,'utf8'));
 const open=async name=>{await evaluate(`window.signatureResult=undefined;window.signatureTask=BonSignatures.capture('Signature',${JSON.stringify(name)}).then(r=>window.signatureResult=r);true`);return evaluate(`(()=>{const r=document.querySelector('dialog canvas').getBoundingClientRect();return {x:r.x+20,y:r.y+40}})()`);};
 const submit=()=>evaluate(`(async()=>{document.querySelector('dialog form').requestSubmit();await signatureTask;return signatureResult})()`);
 const mouse=await open('Technicien');
 await command('Input.dispatchMouseEvent',{type:'mousePressed',x:mouse.x,y:mouse.y,button:'left',buttons:1,clickCount:1});
 for(const [dx,dy] of [[20,15],[40,-10],[65,20]])await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:mouse.x+dx,y:mouse.y+dy,button:'left',buttons:1});
 await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:mouse.x+65,y:mouse.y+20,button:'left',buttons:0,clickCount:1});
 const drawn=await submit();assert.match(drawn.image,/^data:image\/png;base64,/);assert.equal(drawn.name,'Technicien');
 await command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 const touch=await open('Coordinateur');
 await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touch.x,y:touch.y}]});
 await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x+50,y:touch.y+25}]});
 await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const mobile=await submit();assert.match(mobile.image,/^data:image\/png;base64,/);
 await open('Validateur');await evaluate(`document.querySelector('[data-clear]').click();true`);const nameOnly=await submit();assert.equal(nameOnly.image,null);assert.equal(nameOnly.name,'Validateur');
 await open('Gestionnaire');const cancelled=await evaluate(`(async()=>{BonSignatures.cancel();await signatureTask;return signatureResult})()`);assert.equal(cancelled,null);
 // Four distinct images and names are rendered in the real PDF signature table.
 await evaluate('window.drawn='+JSON.stringify(drawn)+';window.mobile='+JSON.stringify(mobile));
 const pdf=await evaluate(`(()=>{const doc=new jspdf.jsPDF(),texts=[];let images=0;const add=doc.addImage.bind(doc),text=doc.text.bind(doc);doc.addImage=(...args)=>{images++;return add(...args)};doc.text=(s,...args)=>{texts.push(Array.isArray(s)?s.join(' '):s);return text(s,...args)};const bon={bonSignatures:Object.fromEntries(['technician','coordination','validator','manager'].map((role,i)=>[role,{...(i%2?mobile:drawn),name:['Technicien','Coordinateur','Validateur','Gestionnaire'][i],at:'2026-09-26T10:00:00Z'}]))};BonSignatures.pdf(doc,bon,{},20);return {images,texts,pdf:doc.output('datauristring').split(',')[1],missing:BonSignatures.entries({},{}).map(s=>s.name)}})()`);
 assert.equal(pdf.images,4);for(const title of ['Technicien','Coordinateur','Validateur','Gestionnaire'])assert.ok(pdf.texts.includes(title));assert.deepEqual(pdf.missing,['','','','']);
 fs.writeFileSync('.tools/bon-four-signatures.pdf',Buffer.from(pdf.pdf,'base64'));
 console.log('PASS: real mouse and touch strokes, PNG capture, optional drawing, cancellation and four named signature zones/images in PDF.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{ws?.close();chrome?.kill()});
