const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const BonReference=require('../assets/bon-reference');
const source=fs.readFileSync('index.html','utf8');
function extract(name){const start=source.search(new RegExp('^      (?:async )?function '+name+'\\(','m'));assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n      }',start)+8);}
const context={BonReference,appData:{},getSortieItems:()=>[],getSortieSignatureText:()=>'',getSortieTechnicianSignatureText:()=>'',getSortieCoordinationSignatureText:()=>'',getBonEquipeName:()=>'',formatDemandeOps:()=>'',getBonReference:()=> 'TEST',addLogoToPdf:async()=>{},drawValidatedStamp(){},window:{ValidatorWorkflow:{trace:()=>''},BonScanner:{pdf:async(doc,record,data,y)=>y+34}}};
context.window.BonReference=BonReference;
vm.createContext(context);vm.runInContext(fs.readFileSync('assets/bon-signatures.js','utf8'),context);vm.runInContext(extract('getPdfSafeDateParts')+'\n'+extract('drawSortieBonBesoinPdf'),context);
function date(value){return JSON.parse(JSON.stringify(context.getPdfSafeDateParts(value)));}
const expected={day:'24',month:'09',year:'2026'};
for(const value of ['2026-09-24','2026-09-24T16:28:02.410215+00:00','2026-09-24T23:59:59-03:00','24/09/2026','24/09/2026 16:28:02','24.09.2026','24-09-2026'])assert.deepEqual(date(value),expected);
for(const value of [null,'','incorrect','31/02/2026','2026-02-30','26 / 09 / 24'])assert.deepEqual(date(value),{day:'--',month:'--',year:'----'});
assert.deepEqual(date('2024-02-29'),{day:'29',month:'02',year:'2024'});
async function render(record){
 const texts=[],tables=[];
 const doc={internal:{pageSize:{getWidth:()=>210}},lastAutoTable:{finalY:35},setFont(){},setFontSize(){},setTextColor(){},setDrawColor(){},text:text=>texts.push(text),splitTextToSize:text=>[text],autoTable:table=>{tables.push(table);doc.lastAutoTable.finalY+=30}};
  await context.drawSortieBonBesoinPdf(doc,record);
 assert.deepEqual(Array.from(tables.at(-1).head[0]),['Technicien','Coordinateur','Validateur','Gestionnaire']);
 return {header:tables[0].body[0][2],texts};
}
(async()=>{
 const record={id:'SORTIE-1',company_id:'A',date:'2026-09-24T16:28:02.410215+00:00'};
 let pdf=await render(record);assert.match(pdf.header,/Cree le 24\/09\/2026/);
 assert.ok(pdf.texts.includes('Fiche recue le : 24 / 09 / 2026'));assert.ok(pdf.texts.includes('Echeance de la Demande : 24 / 09 / 2026'));
 pdf=await render({...record,dateBon:'2026-09-20',validatedAt:'2026-09-25',updatedAt:'2026-09-26'});assert.match(pdf.header,/20\/09\/2026/,'saved date takes precedence over processing dates');
 const demande={id:'D1',company_id:'A',sortieId:record.id,date:'2026-09-01'};
 context.appData={sorties:[{...record,sourceDemandeId:'D1'}]};pdf=await render(demande);assert.match(pdf.header,/24\/09\/2026/,'request download uses the linked bon date');
 pdf=await render({...demande,company_id:'B'});assert.match(pdf.header,/01\/09\/2026/,'no cross-company date lookup');
 context.appData={};pdf=await render({createdAt:'2026-09-24T00:00:00Z'});assert.match(pdf.header,/24\/09\/2026/);
 pdf=await render({date:'invalid'});assert.match(pdf.header,/Non renseignee/);assert.ok(pdf.texts.includes('Fiche recue le : -- / -- / ----'),'never substitute export date');
 console.log('PASS: PDF header and body use the saved bon date; ISO/local parsing, timezone stability, selected dates, linked records and invalid dates.');
})().catch(error=>{console.error(error);process.exitCode=1});
