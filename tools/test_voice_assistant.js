const assert=require('node:assert/strict');
const VoiceAssistant=require('../assets/voice-assistant');
function setup() {
  let input='Brouillon non envoyé',session='A:user',busy=false;
  const instances=[],submitted=[],states=[],errors=[],spoken=[],timers=new Map();let timerId=0;
  class Recognition {constructor(){instances.push(this)}start(){this.onstart?.()}abort(){this.aborted=true;this.onend?.()}}
  class Utterance {constructor(text){this.text=text}}
  const host={isSecureContext:true,SpeechRecognition:Recognition,SpeechSynthesisUtterance:Utterance,speechSynthesis:{cancel(){},getVoices:()=>[{lang:'fr-FR'}],speak:u=>spoken.push(u)}};
  const voice=new VoiceAssistant({host,getInput:()=>input,setInput:v=>input=v,session:()=>session,isBusy:()=>busy,onSubmit:()=>submitted.push(input),onState:(...s)=>states.push(s),onError:e=>errors.push(e),setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId},clearTimeout:id=>timers.delete(id)});
  const result=(text,final=true)=>{const r=[{transcript:text}];r.isFinal=final;instances.at(-1).onresult({results:[r]})};
  return {voice,host,instances,submitted,states,errors,spoken,result,timers,flush:()=>{const scheduled=[...timers.values()];timers.clear();scheduled.forEach(t=>t.fn())},input:()=>input,setSession:v=>session=v,setBusy:v=>busy=v};
}
const test=setup();test.voice.start();test.result('Exporte le stock en PDF');const end=test.instances[0].onend;end();end();
assert.deepEqual(test.submitted,['Exporte le stock en PDF']);
test.voice.speak('**Rapport généré**');assert.equal(test.spoken[0].text,'Rapport généré');assert.equal(test.spoken[0].lang,'fr-FR');test.spoken[0].onend();assert.match(test.states.at(-1)[1],/À vous/);
const empty=setup();empty.voice.start();empty.instances[0].onend();assert.equal(empty.submitted.length,0);assert.equal(empty.input(),'Brouillon non envoyé');
const interim=setup();interim.voice.start();interim.result('Exporte les',false);interim.instances[0].onend();assert.equal(interim.submitted.length,0);
const cancelled=setup();cancelled.voice.start();cancelled.result('Ouvre les stocks');const oldEnd=cancelled.instances[0].onend;cancelled.voice.stop();oldEnd();assert.equal(cancelled.submitted.length,0);assert.equal(cancelled.input(),'Brouillon non envoyé');assert.equal(cancelled.instances[0].aborted,true);
const failed=setup();failed.voice.start();failed.result('Exporte le stock');const failedEnd=failed.instances[0].onend;failed.instances[0].onerror({error:'not-allowed'});failedEnd();assert.equal(failed.submitted.length,0);assert.match(failed.errors[0],/refusé/);
const changed=setup();changed.voice.start();changed.result('Ouvre les audits');changed.setSession('B:another');changed.instances[0].onend();assert.equal(changed.submitted.length,0);
const busy=setup();busy.setBusy(true);busy.voice.start();assert.equal(busy.instances.length,0);
const unavailable=setup();delete unavailable.host.SpeechRecognition;unavailable.voice.start();assert.match(unavailable.errors[0],/n’est pas disponible/);
const insecure=setup();insecure.host.isSecureContext=false;insecure.voice.start();assert.match(insecure.errors[0],/HTTPS/);
const unsupportedSpeech=setup();unsupportedSpeech.voice.enabled=true;delete unsupportedSpeech.host.speechSynthesis;unsupportedSpeech.voice.speak('Réponse');assert.match(unsupportedSpeech.states.at(-1)[1],/n’est pas disponible/);
const stopReading=setup();stopReading.voice.enabled=true;stopReading.voice.speak('Réponse');stopReading.voice.stop();stopReading.spoken[0].onend();assert.equal(stopReading.states.at(-1)[1],'Mode vocal arrêté.');
const fast=setup();fast.voice.start();fast.result('Ouvre les inventaires');assert.equal([...fast.timers.values()][0].ms,800);fast.flush();assert.equal(fast.submitted.length,1);assert.equal(fast.instances[0].aborted,true);
const continuation=setup();continuation.voice.start();continuation.result('Exporte les anomalies');continuation.instances[0].onspeechstart();assert.equal(continuation.timers.size,0);
const segment=(text,final,confidence)=>{const r=[{transcript:text,confidence}];r.isFinal=final;return r;};
continuation.instances[0].onresult({results:[segment('Exporte les anomalies',true,.95),segment('en',false)]});assert.equal([...continuation.timers.values()][0].ms,2500);
continuation.instances[0].onresult({results:[segment('Exporte les anomalies',true,.95),segment('en PDF',true,.97)]});continuation.flush();assert.deepEqual(continuation.submitted,['Exporte les anomalies en PDF']);
const uncertain=setup();uncertain.voice.start();uncertain.instances[0].onresult({results:[segment('Exporte les sorties',true,.4)]});uncertain.flush();assert.equal(uncertain.submitted.length,0);assert.equal(uncertain.states.at(-1)[0],'review');assert.equal(uncertain.input(),'Exporte les sorties');
const ambiguous=setup();ambiguous.voice.start();const alternatives=segment('Stock ITC B01',true,.88);alternatives.push({transcript:'Stock ITC B02',confidence:.85});ambiguous.instances[0].onresult({results:[alternatives]});ambiguous.flush();assert.equal(ambiguous.states.at(-1)[0],'review');assert.equal(ambiguous.submitted.length,0);
const cut=setup();cut.voice.start();cut.result('Exporte le stock en');cut.flush();assert.equal(cut.states.at(-1)[0],'review');assert.equal(cut.submitted.length,0);
const partial=setup();partial.voice.start();partial.result('Exporte le',false);partial.flush();assert.equal(partial.states.at(-1)[0],'review');assert.equal(partial.submitted.length,0);
const cancelTimer=setup();cancelTimer.voice.start();cancelTimer.result('Ouvre les audits');cancelTimer.voice.stop();assert.equal(cancelTimer.timers.size,0);cancelTimer.flush();assert.equal(cancelTimer.submitted.length,0);
const spelled=setup();spelled.voice.start();spelled.result('Exporte le stock I T C B 0 2 en P D F');spelled.flush();assert.equal(spelled.submitted[0],'Exporte le stock ITC-B02 en PDF');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');const start=source.indexOf('      function aiNavigateToSection(');
const delays=[],pages=[];const navigation={voiceAssistant:{enabled:true},setTimeout:(fn,ms)=>{delays.push(ms);fn()},showSection:id=>pages.push(id),toggleChatAssistant:()=>{throw new Error('Voice navigation must not close speech')}};
vm.createContext(navigation);vm.runInContext(source.slice(start,source.indexOf('\n      }',start)+8),navigation);navigation.aiNavigateToSection('control-dashboard');assert.deepEqual(delays,[0,0]);assert.deepEqual(pages,['control-dashboard']);
console.log('PASS: 800 ms stable-final dispatch, continuation resets deadline, partial/ambiguous/low-confidence review, cancellation, session isolation and speech feedback.');
