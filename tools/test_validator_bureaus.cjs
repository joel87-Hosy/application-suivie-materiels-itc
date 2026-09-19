const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync('assets/validator-workflow.js','utf8'),context);
const workflow=context.window.ValidatorWorkflow;
for(const [bureau,allowed] of [['B01',['ITC-B01','CIC','MTN','OCI']],['B02',['ITC-B02','MOOV']]]){
 workflow.setup({profile:()=>({role:'Validateur',validationBureau:bureau,controlScopes:Object.fromEntries(allowed.map(op=>[op,true]))})});
 for(const op of ['ITC-B01','ITC-B02','CIC','MTN','OCI','MOOV'])assert.equal(workflow.covers({op,items:[{label:'Cable',qty:1}]}),allowed.includes(op),bureau+' / '+op);
 assert.equal(workflow.covers({op:'ITC',items:[{label:'Cable',qty:1}]}),bureau==='B01');
 assert.equal(workflow.covers({items:[{op:'ITC-B01'},{op:'MOOV'}]}),false,'mixed bureaux not actionable');
 assert.equal(workflow.covers({items:[]}),false);assert.equal(workflow.covers({}),false);
}
workflow.setup({profile:()=>({role:'Validateur',controlScopes:{}})});assert.equal(workflow.covers({op:'ITC-B01',items:[{}]}),false);
console.log('PASS: B01/B02 inbox scopes, six stocks, legacy ITC alias, mixed requests and unassigned validators.');
