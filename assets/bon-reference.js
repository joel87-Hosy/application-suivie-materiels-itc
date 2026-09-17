/* Human-readable references; database IDs and QR payloads remain stable. */
(function(global) {
  const services={B2B:'B2B',DEP:'Déploiement',MAIN:'Maintenance'};
  const slug=value=>String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  function dateCode(value) {
    const raw=String(value || '').trim();
    const iso=raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
    const local=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|\D)/);
    if(!iso && !local)return '';
    const [year,month,day]=iso?iso.slice(1).map(Number):[Number(local[3]),Number(local[2]),Number(local[1])];
    const parsed=new Date(Date.UTC(year,month-1,day));
    if(parsed.getUTCFullYear()!==year || parsed.getUTCMonth()!==month-1 || parsed.getUTCDate()!==day)return '';
    return `${year}${String(month).padStart(2,'0')}${String(day).padStart(2,'0')}`;
  }
  function resolve(record, data={}) {
    const sameCompany=row=>row.company_id===record.company_id;
    const sortie=(data.sorties || []).find(row=>sameCompany(row) && ((record.sortieId && row.id===record.sortieId) || (row.sourceDemandeId && row.sourceDemandeId===record.id)));
    const demande=record.sourceDemandeId?(data.demandes || []).find(row=>sameCompany(row) && row.id===record.sourceDemandeId):null;
    return sortie ? {...record,...sortie} : demande ? {...demande,...record} : record;
  }
  function format(record, {data={},departmentCode=''}={}) {
    const bon=resolve(record || {},data);
    const service=slug(bon.serviceAbbreviation || bon.departmentCode || departmentCode) || 'SERVICE-NR';
    const motif=slug(bon.motif || bon.ref || bon.reference || bon.objectif).slice(0,60).replace(/-+$/,'') || 'MOTIF-NR';
    const pending=!bon.sourceDemandeId && !String(bon.id || '').startsWith('SORTIE-') && !['LIVREE','LIVRÉE'].includes(bon.status || bon.statut);
    const date=pending?'EN-ATTENTE':[bon.dateBon,bon.dateLivraison,bon.dateSortie,bon.date].map(dateCode).find(Boolean) || 'DATE-NR';
    const id=String(bon.sourceDemandeId || bon.id || bon._dbKey || '');
    const match=id.match(/^([A-Z]+)-(\d+)$/i);
    const serial=bon._dbKey ? String(bon._dbKey).replace(/[^a-zA-Z0-9_-]/g,'') : match ? `${match[1].toUpperCase()}${BigInt(match[2]).toString(36).toUpperCase()}` : slug(id) || 'NUMERO-NR';
    return `${service}-${motif}-${date}-${serial}`;
  }
  const api={format,resolve,dateCode,services};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else global.BonReference=api;
})(typeof window==='undefined'?globalThis:window);
