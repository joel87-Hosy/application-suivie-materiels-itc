/* Deterministic report commands: no model-generated code is executed. */
(function(global) {
  const normal = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const titles = {stock:'État du stock',movements:'Mouvements de stock',control:'Synthèse des contrôles',inventories:'Inventaires',audits:'Audits',anomalies:'Anomalies',actions:'Plans d’action',missions:'Missions de contrôle'};
  const statuses = {draft:'Brouillon',counting:'Comptage en cours',review:'À approuver',approved:'Approuvé — à régulariser',closed:'Clôturé',cancelled:'Annulé',open:'Ouvert',planned:'Planifié',progress:'En cours',verify:'À vérifier',justification:'À justifier'};
  function parse(text, role, section, clock = new Date()) {
    const q=normal(text);
    if (/^(comment|pourquoi|explique)/.test(q)) return null;
    if (!/\b(pdf|excel|xlsx)\b/.test(q) || !/rapport|export|genere|telecharg|fichier|tire|donne|cree|prepare|envoie|sors|sortir/.test(q)) return null;
    if (/\bpdf\b/.test(q) && /\b(excel|xlsx)\b/.test(q)) return {error:'Choisissez un format par demande : Excel ou PDF.'};
    const format=/\bpdf\b/.test(q)?'pdf':'xlsx';
    let kind = /anomalie/.test(q)?'anomalies':/audit/.test(q)?'audits':/inventaire/.test(q)?'inventories':/\bactions?\b/.test(q)?'actions':/mission/.test(q)?'missions':/mouvement|flux|entree|sortie|retour/.test(q)?'movements':/controle|tableau de bord/.test(q)?'control':/stock/.test(q)?'stock':null;
    if (/consommation|hebdo|archive|\bbon\b|\bbons\b|facture/.test(q)) return {error:'Cette commande génère les rapports de stock, mouvements et contrôles. Précisez par exemple « Exporte les mouvements en Excel ». Les bons et archives conservent leurs exports dans leurs modules.'};
    if (!kind) { const page=String(section || '').replace('control-',''); kind=page==='flows'?'movements':titles[page]?page:role==='Contrôleur'?'control':'stock'; }
    const stocks=[...new Set((q.match(/\bitc[- ]?b0?[12]\b|\boci(?:-cic)?\b|\bcic\b|\bmtn\b|\bmoov\b/g)||[]).map(v=>v.replace(/itc[- ]?b0?([12])/,'ITC-B0$1').toUpperCase()))];
    if (/\bitc\b/.test(q) && !stocks.some(s=>s.startsWith('ITC-'))) return {error:'Précisez le bureau ITC-B01 ou ITC-B02 pour ce rapport.'};
    const dates=q.match(/\b\d{4}-\d{2}-\d{2}\b/g)||[];
    let from='',to='';
    if (dates.length) {
      if (dates.length!==2 || dates.some(d=>!Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0,10)!==d) || dates[0]>dates[1]) return {error:'Indiquez une période valide : du AAAA-MM-JJ au AAAA-MM-JJ.'};
      [from,to]=dates;
    } else if (/aujourd/.test(q)) from=to=clock.toISOString().slice(0,10);
    else if (/ce mois|mois en cours|mois dernier/.test(q)) {
      const shift=/mois dernier/.test(q)?1:0;
      from=new Date(Date.UTC(clock.getUTCFullYear(),clock.getUTCMonth()-shift,1)).toISOString().slice(0,10);
      to=new Date(Date.UTC(clock.getUTCFullYear(),clock.getUTCMonth()-shift+1,0)).toISOString().slice(0,10);
    } else if (/\b(semaine|hier|mois|annee|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b|\b(du|depuis|entre)\s+\d/.test(q)) return {error:'Pour filtrer la période, indiquez « du AAAA-MM-JJ au AAAA-MM-JJ », « aujourd’hui », « ce mois » ou « mois dernier ».'};
    if(kind==='stock' && from) return {error:'Le rapport de stock représente les quantités actuelles. Pour une période, demandez un rapport des mouvements.'};
    return {format,kind,stocks,from,to,flow:kind==='movements'?/entree/.test(q)?'in':/sortie/.test(q)?'out':/retour/.test(q)?'return':null:null};
  }
  async function build(request, env) {
    const {profile,data,normalizeOperator,allowedStock}=env;
    if (!profile?.company_id || profile.is_active !== true) throw new Error('Connectez-vous avec un compte actif pour exporter.');
    const scoped = row => row.company_id===profile.company_id && allowedStock(normalizeOperator(row.op));
    const selected=request.stocks.map(normalizeOperator);
    if(selected.some(op=>!allowedStock(op))) throw new Error('Un des stocks demandés est hors de votre périmètre.');
    const include=row=>scoped(row) && (!selected.length || selected.includes(normalizeOperator(row.op)));
    const inPeriod=value=>!request.from || (!!value && String(value).slice(0,10)>=request.from && String(value).slice(0,10)<=request.to);
    let headers,rows,notes=[];
    if(request.kind==='stock') {
      headers=['Stock','Matériel','Type','Quantité actuelle'];
      rows=(data.stock||[]).filter(include).map(r=>[normalizeOperator(r.op),r.label||'',r.type||'',Number(r.qty)||0]);
      notes.push('Photographie des quantités enregistrées au moment de la génération.');
    } else if(request.kind==='movements') {
      headers=['Date','Stock','Matériel','Mouvement','Avant','Après','Variation','Référence','Auteur'];
      rows=(data.stockMovements||[]).filter(r=>include(r)&&inPeriod(r.createdAt)&&(!request.flow||r.type===request.flow)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(r=>[r.createdAt||'',normalizeOperator(r.op),r.label||'',({in:'Entrée',out:'Sortie',return:'Retour',adjustment:'Régularisation'})[r.type]||r.type,r.before,r.after,r.qty,r.reference||'',r.actorUid||'']);
      notes.push('Journal des mouvements enregistrés ; les opérations anciennes sans journal ne sont pas reconstituées.');
    } else {
      if(!['Contrôleur','Gestionnaire','Superviseur'].includes(profile.role)) throw new Error('Les rapports de contrôle sont réservés aux rôles Contrôleur, Gestionnaire et Superviseur.');
      const available=[...new Set([...(data.stock||[]).filter(scoped).map(r=>normalizeOperator(r.op)),...(env.controlStocks||[]).filter(allowedStock)])];
      const target=selected.length?selected:available;
      const kinds=request.kind==='control'?['inventories','audits','anomalies','actions','missions']:[request.kind];
      headers=['Stock','Module','Référence','Objet','Statut','Responsable','Création','Échéance','Gravité'];rows=[];
      for(const op of target) {
        const records=await env.readControl(op);
        for(const kind of kinds) for(const [id,r] of Object.entries(records?.[kind]||{})) {
          if(!inPeriod(r.createdAt)) continue;
          rows.push([op,titles[kind],id,r.title||'',statuses[r.status]||r.status||'',r.assignee||'',r.createdAt||'',r.due||'',r.severity||'']);
        }
      }
      notes.push('Synthèse des dossiers ; les comptages individuels et les pièces jointes ne sont pas exportés. La période filtre la date de création des dossiers.');
    }
    if(!rows.length) throw new Error('Aucune donnée accessible ne correspond à ce rapport. Aucun fichier n’a été généré.');
    return {title:titles[request.kind],headers,rows,notes,company:profile.company_id,scope:selected.length?selected.join(', '):'Tous les stocks autorisés de l’entreprise',period:request.from?`${request.from} au ${request.to}`:'Toutes dates disponibles',generatedAt:new Date().toISOString(),format:request.format};
  }
  async function download(report, deps) {
    const filename='Rapport-'+report.title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-')+'-'+report.generatedAt.slice(0,10)+'.'+report.format;
    const metadata=[`Entreprise : ${report.company}`,`Périmètre : ${report.scope}`,`Période : ${report.period}`,`Généré le : ${report.generatedAt}`,...report.notes];
    if(report.format==='xlsx') {
      if(!deps.ExcelJS?.Workbook) throw new Error('Le moteur Excel n’est pas chargé. Vérifiez la connexion et rechargez la page.');
      const workbook=new deps.ExcelJS.Workbook();workbook.creator='Application de gestion de matériels';
      const sheet=workbook.addWorksheet('Rapport');
      sheet.addRow([report.title]);metadata.forEach(line=>sheet.addRow([line]));sheet.addRow([]);
      const heading=sheet.addRow(report.headers);heading.font={bold:true,color:{argb:'FFFFFFFF'}};heading.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF153E53'}};
      report.rows.forEach(row=>sheet.addRow(row.map(v=>typeof v==='number'?v:String(v??''))));
      sheet.columns.forEach((col,i)=>{col.width=i===1?32:24;});
      sheet.views=[{state:'frozen',ySplit:heading.number}];sheet.autoFilter={from:{row:heading.number,column:1},to:{row:heading.number,column:report.headers.length}};
      const buffer=await workbook.xlsx.writeBuffer();
      deps.ensureSession();
      deps.saveBlob(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),filename);
    } else {
      if(!deps.jsPDF) throw new Error('Le moteur PDF n’est pas chargé. Vérifiez la connexion et rechargez la page.');
      const doc=new deps.jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
      if(typeof doc.autoTable!=='function') throw new Error('Le module de tableaux PDF n’est pas chargé. Rechargez la page.');
      doc.setFontSize(16);doc.text(report.title,14,16);doc.setFontSize(9);
      const text=doc.splitTextToSize(metadata.join('\n'),268);doc.text(text,14,24);
      doc.autoTable({head:[report.headers],body:report.rows,startY:28+text.length*4,styles:{fontSize:8,overflow:'linebreak'},headStyles:{fillColor:[21,62,83]},margin:{left:14,right:14,bottom:16}});
      const pages=doc.getNumberOfPages();for(let page=1;page<=pages;page++){doc.setPage(page);doc.text(`${page} / ${pages}`,275,201);}
      deps.ensureSession();
      deps.saveBlob(doc.output('blob'),filename);
    }
    return filename;
  }
  const api={parse,build,download};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else global.AssistantReports=api;
})(typeof window==='undefined'?globalThis:window);
