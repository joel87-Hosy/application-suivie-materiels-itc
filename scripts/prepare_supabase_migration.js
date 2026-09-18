// Read-only Firebase export; writes only to ignored local backup storage.
const fs=require('fs'),path=require('path');
const {initializeApp,cert,deleteApp}=require('firebase-admin/app');
const {getDatabase}=require('firebase-admin/database');
const {getAuth}=require('firebase-admin/auth');
const core=require('./supabase_migration_core');
async function main(){
  const key=JSON.parse(fs.readFileSync(path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS||'tools/serviceAccountKey.json'),'utf8'));
  if(key.project_id!=='itc-erp')throw Error('Projet Firebase inattendu.');
  const app=initializeApp({credential:cert(key),databaseURL:'https://itc-erp-default-rtdb.europe-west1.firebasedatabase.app'});
  try{
    const at=new Date().toISOString(),id='firebase-'+at.replace(/[:.]/g,'-');
    const dir=path.resolve('.security-backups','supabase-migration',id);fs.mkdirSync(dir,{recursive:true});
    const write=(name,data)=>fs.writeFileSync(path.join(dir,name),typeof data==='string'?data:JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
    const root=(await getDatabase(app).ref().once('value')).val();
    if(!root?.itc_data||!root?.auth_profiles)throw Error('Export Firebase incomplet.');
    write('firebase-database.json',root);
    const accounts=[];let pageToken;
    do{const page=await getAuth(app).listUsers(1000,pageToken);accounts.push(...page.users.map(u=>u.toJSON()));pageToken=page.pageToken;}while(pageToken);
    write('firebase-auth.json',accounts);
    const report=core.manifest(root,accounts,{id,exportedAt:at,project:key.project_id});
    write('manifest.json',report);
    const schema=fs.readFileSync('supabase/migrations/202609170001_migration_staging.sql','utf8');
    write('import-private-staging.sql',core.makeSql(root,accounts,report,schema));
    console.log(JSON.stringify({backupDirectory:dir,accountCount:accounts.length,documentCount:report.documentCount,recordCounts:report.recordCounts,issues:report.issues.length,status:'Sauvegarde et import privé préparés ; aucune bascule effectuée.'},null,2));
  }finally{await deleteApp(app);}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
