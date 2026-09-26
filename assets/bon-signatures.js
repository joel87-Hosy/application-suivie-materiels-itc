(function(global){
  'use strict';
  let active=null;
  const roles=[['technician','Technicien'],['coordination','Coordinateur'],['validator','Validateur'],['manager','Gestionnaire']];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function capture(title,name=''){
    if(active)return Promise.resolve(null);
    return new Promise(resolve=>{
      const modal=document.createElement('dialog');active=modal;
      modal.style.cssText='width:min(94vw,680px);max-height:94vh;border:0;border-radius:18px;padding:22px;';
      modal.innerHTML=`<form class="space-y-4"><h2 class="text-xl font-bold">${esc(title)}</h2><label class="block">Nom complet<input name="signer" required maxlength="120" autocomplete="name" value="${esc(name)}" class="border rounded-xl p-3 w-full"></label><p>Dessinez votre signature au doigt sur téléphone ou avec la souris sur ordinateur. Le dessin est facultatif ; votre nom reste obligatoire.</p><canvas width="640" height="200" aria-label="Zone de signature manuscrite" style="display:block;width:100%;aspect-ratio:16/5;touch-action:none;background:white;border:2px solid #94a3b8;border-radius:12px;cursor:crosshair;"></canvas><button type="button" data-clear class="border rounded-xl p-3">Effacer le dessin</button><p data-status role="status">Aucun dessin : confirmation avec le nom uniquement.</p><div class="flex gap-3"><button type="submit" class="bg-indigo-700 text-white p-3 rounded-xl">Confirmer ma signature</button><button type="button" data-cancel class="border p-3 rounded-xl">Annuler</button></div></form>`;
      document.body.append(modal);modal.showModal();
      const canvas=modal.querySelector('canvas'),ctx=canvas.getContext('2d');
      ctx.strokeStyle='#13213c';ctx.fillStyle='#13213c';ctx.lineWidth=2.5;ctx.lineCap='round';ctx.lineJoin='round';
      let pointer=null,drawn=false,result=null;
      const point=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*640/r.width,(e.clientY-r.top)*200/r.height]};
      canvas.onpointerdown=e=>{if(pointer!==null||e.button>0)return;e.preventDefault();pointer=e.pointerId;canvas.setPointerCapture(pointer);const [x,y]=point(e);ctx.beginPath();ctx.arc(x,y,1.25,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.moveTo(x,y);drawn=true;modal.querySelector('[data-status]').textContent='Signature dessinée prête à être enregistrée.';};
      canvas.onpointermove=e=>{if(e.pointerId!==pointer)return;e.preventDefault();const [x,y]=point(e);ctx.lineTo(x,y);ctx.stroke();};
      const finish=e=>{if(e.pointerId===pointer)pointer=null;};canvas.onpointerup=finish;canvas.onpointercancel=finish;canvas.onlostpointercapture=finish;
      modal.querySelector('[data-clear]').onclick=()=>{ctx.clearRect(0,0,640,200);pointer=null;drawn=false;modal.querySelector('[data-status]').textContent='Dessin effacé. Vous pouvez signer à nouveau.';};
      modal.querySelector('[data-cancel]').onclick=()=>modal.close();
      modal.querySelector('form').onsubmit=e=>{e.preventDefault();const name=e.target.elements.signer.value.trim();if(!name)return;result={name,image:drawn?canvas.toDataURL('image/png'):null};modal.close();};
      modal.onclose=()=>{active=null;modal.remove();resolve(result);};
    });
  }
  function entries(record,data){
    const bon=global.BonReference.resolve(record,data),signed=bon.bonSignatures||{};
    return roles.map(([key,label])=>{
      const legacy={technician:[bon.technicianSignatureText,bon.technicianSignedAt],coordination:[bon.coordinationSignatureText,bon.coordinationSignedAt],validator:[bon.validatorDecision?.name,bon.validatorDecision?.at],manager:[bon.managerSignatureText||((bon.managerSignedAt||bon.validatedAt)?bon.validatedBy:null),bon.managerSignedAt||bon.validatedAt]}[key];
      const evidence=signed[key];
      const name=evidence?.name||legacy[0]||'';
      const at=evidence?.at||legacy[1];
      const date=at&&!Number.isNaN(Date.parse(at))?new Date(at).toLocaleString('fr-FR'):at||'';
      const image=typeof evidence?.image==='string'&&evidence.image.startsWith('data:image/png;base64,')?evidence.image:null;
      return {key,label,name,date,image,refused:key==='validator'&&bon.validatorDecision?.approved===false};
    });
  }
  function pdf(doc,record,data,y){
    const rows=entries(record,data);
    doc.autoTable({startY:y,margin:{left:14,right:14},theme:'grid',head:[rows.map(s=>s.label)],
      body:[rows.map(s=>s.name?`${s.name}${s.date?'\n'+s.date:''}${s.refused?'\nDécision : refus':''}`:'Signature non renseignée')],
      styles:{font:'helvetica',fontSize:7.2,cellPadding:{top:3,right:2,bottom:22,left:2},halign:'center',valign:'top',minCellHeight:43,lineColor:[20,20,20],lineWidth:0.25},
      headStyles:{fillColor:[255,255,255],textColor:[20,20,20],fontStyle:'bold',cellPadding:3},
      pageBreak:'avoid',rowPageBreak:'avoid',
      didDrawCell:cell=>{if(cell.section!=='body')return;const image=rows[cell.column.index]?.image;if(image){const width=cell.cell.width-6;doc.addImage(image,'PNG',cell.cell.x+3,cell.cell.y+cell.cell.height-20,width,width*200/640);}},
    });
    return doc.lastAutoTable.finalY;
  }
  global.BonSignatures={capture,entries,pdf,cancel:()=>active?.close()};
})(window);
