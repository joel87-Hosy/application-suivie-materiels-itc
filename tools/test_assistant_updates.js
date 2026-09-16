const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const knowledge=require('../assets/assistant-knowledge');
const source=fs.readFileSync('index.html','utf8');
function extract(name){const start=source.indexOf('      function '+name+'(');assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n      }',start)+8);}
const navigation=[];
const context={AssistantKnowledge:knowledge,currentUser:{role:'Contrôleur',name:'Test'},currentSectionId:'control-dashboard',window:{StockControl:{assistantContext:()=>({loaded:true,stock:'ITC-B02',activeInventories:2,openAnomalies:3,criticalAnomalies:1,actionsToVerify:1,overdueActions:0,activeAudits:2,activeMissions:1,awaitingApproval:1,awaitingAdjustment:0})}},aiNavigateToSection:id=>navigation.push(id),appData:{stock:[{label:'SECRET COMPTAGE',qty:999}]},document:{getElementById:()=>({innerHTML:''})},escapeHtml:v=>String(v).replace(/"/g,'&quot;')};
vm.createContext(context);
for(const name of ['aiParseAndExecuteAction','getLocalAssistantReply','getRoleCapabilities','getChatAssistantSystemPrompt','buildFullAppContext','renderChatQuickActions']) vm.runInContext(extract(name),context);
for(const [question,id] of [['Ouvre les audits','control-audits'],['Ouvre mon tableau de bord','control-dashboard'],['Ouvre les inventaires','control-inventories'],['Ouvre les rapports','control-reports'],['Ouvre les plans d’action','control-actions'],['Ouvre mon profil','mon-profil']]){
  context.aiParseAndExecuteAction(question);assert.equal(navigation.at(-1),id);
}
const before=navigation.length;
assert.equal(context.aiParseAndExecuteAction('Comment créer un inventaire ?'),null);
context.aiParseAndExecuteAction('Enregistre une entrée de stock');
assert.equal(navigation.length,before);
assert.match(context.getLocalAssistantReply('Résume mon tableau de bord'),/ITC-B02/);
assert.match(context.getLocalAssistantReply('Explique les graphiques'),/avant régularisation/);
assert.match(context.getLocalAssistantReply('Comment faire une entrée ?'),/gestionnaire/);
assert.match(context.getRoleCapabilities(),/tous les stocks de votre entreprise/);
const prompt=context.getChatAssistantSystemPrompt();
assert.match(prompt,/control-dashboard/);assert.match(prompt,/ITC-B02/);assert.ok(!prompt.includes('SECRET COMPTAGE'));
const container={innerHTML:''};context.document.getElementById=()=>container;
context.renderChatQuickActions();assert.match(container.innerHTML,/&quot;Résume/);assert.match(container.innerHTML,/Missions de contrôle/);
context.currentUser.role='Gestionnaire';context.aiParseAndExecuteAction('Ouvre les inventaires');assert.equal(navigation.at(-1),'control-inventories');
assert.match(knowledge.reply('entrée matériel déjà présent',{userRole:'Gestionnaire'}),/sans créer de fiche/);
assert.match(knowledge.reply('tableau de bord',{userRole:'Contrôleur',control:{loaded:false}}),/Aucune donnée/);
// Exercise the backend's fallback and provider payload without network or credentials.
let payload;
const backend={require:name=>name==='http'?{createServer:()=>({listen(){}})}:knowledge,process:{env:{GEMINI_API_KEY:'test-only'}},console,fetch:async(url,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'ok'}]}}]})}}};
vm.createContext(backend);vm.runInContext(fs.readFileSync('server/ai-chat-backend.js','utf8'),backend);
assert.match(backend.buildLocalFallbackReply({userText:'inventaire matériel',context:{userRole:'Contrôleur'}}),/Soumettre au superviseur/);
(async()=>{await backend.askGemini({userText:'aide',systemPrompt:'x'.repeat(3500)+'CONTEXTE_RECENT',messages:[]});assert.ok(payload.systemInstruction.parts[0].text.includes('CONTEXTE_RECENT'));assert.ok(payload.systemInstruction.parts[0].text.includes('control-dashboard'));console.log('PASS: role-aware navigation, controller guidance, quick actions, safe control context, backend fallback and untruncated recent context.');})().catch(e=>{console.error(e);process.exitCode=1;});
