'use strict';
const crypto=require('node:crypto');
const collections=['users','companies','stock','stockMovements','sorties','demandes','techDemandes','retours','notifications','consumptionArchives','platformAuditLogs'];
function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
const hash=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
const list=value=>Object.entries(value||{}).filter(([,r])=>r&&typeof r==='object');
function documents(root) {
  const result=[];
  const add=(path,value)=>result.push({source_path:path,company_id:value?.company_id||null,payload:value});
  for(const [section,value] of Object.entries(root)) {
    if(section==='itc_data')for(const [collection,rows] of Object.entries(value||{})) {
      if(collections.includes(collection))for(const [key,row] of Object.entries(rows||{}))add(section+'/'+collection+'/'+key,row);
      else add(section+'/'+collection,rows);
    }
    else if(['auth_profiles','tenant_settings','tenant_branding','push_subscriptions'].includes(section))for(const [key,row] of Object.entries(value||{}))add(section+'/'+key,row);
    else if(['stock_control','cable_offcuts'].includes(section))for(const [company,stores] of Object.entries(value||{}))for(const [op,row] of Object.entries(stores||{}))add(section+'/'+company+'/'+op,row);
    else add(section,value);
  }
  return result;
}
function manifest(root,accounts,{id,exportedAt,project}) {
  const issues=[];
  const users=list(root.itc_data?.users).map(([,u])=>u),auth=new Set(accounts.map(a=>a.uid));
  for(const u of users) {
    if(!u.uid||!auth.has(u.uid))issues.push({kind:'missing_auth_account',userKey:String(u.id??''),uid:u.uid||null});
    const p=root.auth_profiles?.[u.uid];
    if(!p || p.company_id!==u.company_id || p.role!==u.role)issues.push({kind:'security_profile_mismatch',uid:u.uid||null});
  }
  const stocks={};
  for(const [,s] of list(root.itc_data?.stock)) {
    const key=JSON.stringify([s.company_id||'',s.op||'']);
    stocks[key] ||= {company_id:s.company_id||null,op:s.op||null,articles:0,quantity:0};
    stocks[key].articles++;
    if(!Number.isFinite(Number(s.qty)))issues.push({kind:'invalid_stock_quantity',stock:s.label||''});
    else stocks[key].quantity+=Number(s.qty);
  }
  return {version:1,id,exportedAt,project,status:'PREPARATION_ONLY',databaseSha256:hash(root),authSha256:hash(accounts),documentCount:documents(root).length,accountCount:accounts.length,accountsWithPasswordHash:accounts.filter(a=>a.passwordHash).length,rootSections:Object.keys(root).sort(),recordCounts:Object.fromEntries(collections.map(name=>[name,list(root.itc_data?.[name]).length])),stocks:Object.values(stocks),issues};
}
const quote=value=>value==null?'NULL':"'"+String(value).replace(/'/g,"''")+"'";
const json=value=>quote(JSON.stringify(value))+'::jsonb';
function makeSql(root,accounts,report,schema) {
  if(hash(root)!==report.databaseSha256||hash(accounts)!==report.authSha256)throw Error('La sauvegarde ne correspond pas au manifeste.');
  const docs=documents(root);
  const sql=['BEGIN;','SET LOCAL standard_conforming_strings = on;',schema,
    'INSERT INTO migration_private.firebase_snapshots(id,exported_at,source_project,database_sha256,auth_sha256,database_data,auth_accounts,manifest) VALUES ('+
      [quote(report.id),quote(report.exportedAt),quote(report.project),quote(report.databaseSha256),quote(report.authSha256),json(root),json(accounts),json(report)].join(',')+');'];
  for(let i=0;i<docs.length;i+=100)sql.push('INSERT INTO migration_private.firebase_documents(snapshot_id,source_path,company_id,payload) VALUES\n'+docs.slice(i,i+100).map(d=>'('+[quote(report.id),quote(d.source_path),quote(d.company_id),json(d.payload)].join(',')+')').join(',\n')+';');
  sql.push(`DO $$ BEGIN IF (SELECT count(*) FROM migration_private.firebase_documents WHERE snapshot_id=${quote(report.id)}) <> ${docs.length} THEN RAISE EXCEPTION 'Nombre de documents incorrect'; END IF; END $$;`,'COMMIT;');
  return sql.join('\n');
}
function verify(root,accounts,report,imported,importedDocs) {
  if(hash(imported.database_data)!==report.databaseSha256)throw Error('Différence dans les données Firebase importées.');
  if(hash(imported.auth_accounts)!==report.authSha256)throw Error('Différence dans les comptes importés.');
  const expected=documents(root),actual=new Map(importedDocs.map(d=>[d.source_path,d]));
  if(actual.size!==expected.length||importedDocs.length!==expected.length)throw Error('Nombre de documents importés incorrect.');
  for(const doc of expected)if(!actual.has(doc.source_path)||hash(actual.get(doc.source_path).payload)!==hash(doc.payload)||actual.get(doc.source_path).company_id!==doc.company_id)throw Error('Document différent : '+doc.source_path);
  if(hash(accounts)!==report.authSha256)throw Error('Export des comptes modifié.');
  return {verified:true,documents:expected.length,accounts:accounts.length};
}
module.exports={hash,documents,manifest,makeSql,verify};
