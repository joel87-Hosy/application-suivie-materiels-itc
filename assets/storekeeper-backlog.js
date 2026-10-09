(function (global) {
  'use strict';

  let env = null;
  let busy = false;
  let generation = 0;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);

  function normalizedStatus(bon) {
    return String(bon?.status || bon?.statut || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  }

  function alreadySigned(bon) {
    return Boolean(bon?.bonSignatures?.storekeeper || bon?.storekeeperSignature ||
      bon?.storekeeperSignatureText || bon?.storekeeperSignedAt);
  }

  function remainingItems(bon) {
    if (!Array.isArray(bon?.items)) return [];
    const served = bon.materialService?.servedByItem || {};
    return bon.items.map((item, index) => {
      const requested = Number(item?.qty);
      const delivered = Number(served[String(index)]?.qty || 0);
      const unavailable = bon.materialService?.unavailableByItem?.[String(index)];
      return { index, item, requested, delivered, remaining: requested - delivered, unavailable };
    }).filter(row => Number.isFinite(row.remaining) && row.remaining > 0 && !row.unavailable);
  }

  function matchingStock(item, bon) {
    const stock = env?.data?.()?.stock || [];
    const op = String(item?.op || bon?.op || '').trim().toUpperCase();
    const label = String(item?.label || '').trim().replace(/\s+/g, ' ').toUpperCase();
    const keyed = String(item?.stockKey || item?._dbKey || '');
    return stock.find(row => (!keyed || String(row._dbKey || row.id || '') === keyed) &&
      String(row.op || row.operator || '').trim().toUpperCase() === op &&
      String(row.label || row.name || row.designation || '').trim().replace(/\s+/g, ' ').toUpperCase() === label);
  }

  function emitter(bon) {
    if (bon.workflow === 'TECH_BON_SORTIE') {
      return { role: 'Technicien', name: bon.technicienNom || bon.demandeurName || bon.tech };
    }
    if (bon.workflow === 'COORD_DIRECT_BON') {
      const role = bon.createdByRole || (bon.receptionnaireRole === 'Superviseur Terrain' ? 'Superviseur terrain' : 'Coordination');
      return { role, name: bon.createdBy || bon.emetteur || bon.coordinateurNom || bon.demandeurName || bon.tech };
    }
    return {
      role: bon.createdByRole || bon.emitterRole || bon.receptionnaireRole || (bon.coordinateurId ? 'Coordination' : 'Émetteur'),
      name: bon.createdBy || bon.emetteur || bon.coordinateurNom || bon.demandeurName || bon.tech,
    };
  }

  function reference(bon) {
    try { return global.BonReference?.format(bon) || bon.ref || bon.id || bon._dbKey || 'Bon sans référence'; }
    catch (_) { return bon.ref || bon.id || bon._dbKey || 'Bon sans référence'; }
  }

  function localDateValue(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function todayDateValue() {
    return localDateValue(new Date());
  }

  function pendingBons(selectedDate = todayDateValue()) {
    return allPendingBons().filter(bon => localDateValue(bon.managerSignedAt) === selectedDate);
  }

  function allPendingBons() {
    const data = env?.data?.() || {};
    const profile = env?.profile?.(), uid = String(profile?.uid || '');
    const offices = global.AccountAffiliation?.officeList(profile) || [];
    if (!uid || offices.length < 1 || offices.length > 3) return [];
    return (data.demandes || []).filter(bon => {
      const status = normalizedStatus(bon);
      const requestOffice = global.AccountAffiliation?.requestOffice(bon, data.users || []) || bon.validationOffice || bon.originOffice;
      if (!offices.includes(requestOffice)) return false;
      return Boolean(bon.managerSignedAt) && remainingItems(bon).length > 0 && (
        (status === 'EN ATTENTE MAGASINIER' && !alreadySigned(bon)) || status === 'PARTIELLEMENT SERVI'
      );
    }).sort((a, b) => String(a.managerSignedAt || a.date || '').localeCompare(String(b.managerSignedAt || b.date || '')));
  }

  function render(container, selectedDate = todayDateValue()) {
    if (!container || env?.profile?.()?.role !== 'Magasinier') return;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) && selectedDate <= todayDateValue()
      ? selectedDate
      : todayDateValue();
    const rows = pendingBons(date);
    container.innerHTML = `<div class="max-w-5xl mx-auto space-y-5 p-4">
      <header class="rounded-2xl bg-gradient-to-r from-indigo-800 to-teal-700 p-6 text-white">
        <p class="text-[10px] font-bold uppercase tracking-widest opacity-80">Régularisation des remises</p>
        <h2 class="mt-1 text-2xl font-black">Bons servis sans signature magasinier</h2>
        <p class="mt-3 text-sm">Bons approuvés qui attendent encore la confirmation du magasinier. Ouvrez un bon seulement si vous avez déjà remis physiquement les articles. Si le gestionnaire a déjà débité le stock, votre signature enregistre uniquement la remise.</p>
        <div class="mt-4 flex flex-wrap items-end gap-3"><label class="text-sm font-bold">Date de signature du gestionnaire
          <input type="date" data-date-filter max="${todayDateValue()}" value="${date}" class="ml-2 rounded-lg border border-white/60 bg-white px-3 py-2 text-slate-900">
        </label><button type="button" data-refresh class="rounded-lg border border-white/60 px-4 py-2 text-sm font-bold">Actualiser la liste</button></div>
      </header>
      <p class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Les bons déjà marqués « Livrée » ne figurent pas ici : leur stock a peut-être déjà été débité. Cette liste montre uniquement les bons encore en attente de remise ou partiellement servis.</p>
      <p class="text-sm font-bold text-slate-600">${rows.length} bon(s) à vérifier pour le ${date.split('-').reverse().join('/')}</p>
      <div class="space-y-4">${rows.map((bon, index) => {
        const source = emitter(bon);
        const items = remainingItems(bon);
        const total = items.reduce((sum, row) => sum + row.remaining, 0);
        const key = bon._dbKey || bon.id;
        return `<article class="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div><h3 class="text-lg font-black text-slate-900">${esc(reference(bon))}</h3>
              <p class="mt-1 text-sm text-slate-600">Émis par ${esc(source.role)} · ${esc(source.name || 'Nom indisponible')}</p>
              <p class="text-xs text-slate-500">Destinataire : ${esc(bon.equipe || bon.demandeurName || bon.receptionnaireNom || 'Non renseigné')} · Autorisé le ${esc(bon.managerSignedAt || 'date inconnue')}</p>
              <p class="mt-1 text-xs text-slate-500">Motif : ${esc(bon.motif || bon.ref || 'Non renseigné')} · Statut : ${esc(bon.status || bon.statut || '')}</p>
            </div>
            <span class="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-800">${items.length} article(s) · ${esc(total)} unité(s) restantes</span>
          </div>
          <form data-regularize-form="${index}" data-request-key="${esc(key)}" class="divide-y rounded-xl border">${items.map(({index:itemIndex,item,remaining,delivered}) => { const stock=matchingStock(item,bon); const alreadyDebited=Boolean(bon.managerDebitAt); const available=Math.max(0,Number(stock?.qty||0)); const cap=alreadyDebited?remaining:Math.min(remaining,available); const quantityField=`<label>Quantité à servir${alreadyDebited?'':' (stock disponible : '+esc(available)+')'} <input data-qty="${itemIndex}" type="number" min="0" max="${cap}" step="any" value="${cap}" class="ml-2 w-28 rounded border p-2"></label>`; return `<div class="space-y-2 p-3 text-sm"><div class="flex justify-between gap-2"><span class="font-semibold">${esc(item.label || 'Article sans nom')} <span class="text-slate-500">· ${esc(item.op || bon.op || '')}</span></span><span>Reste demandé : <b>${esc(remaining)}</b>${delivered ? ` · déjà servi : ${esc(delivered)}` : ''}</span></div>${alreadyDebited?`<p class="text-emerald-700">Déjà débité par le gestionnaire : signez uniquement la remise physique.</p>${quantityField}`:stock?`${quantityField}${available<remaining?`<p class="text-amber-700">Le stock ne couvre pas toute la quantité demandée.</p>`:''}`:`<p class="text-red-700">Article absent du stock.</p>`}<label class="block"><input type="checkbox" data-unavailable="${itemIndex}" ${cap>=remaining?'disabled':''}> Matériel indisponible pour le reliquat</label></div>`; }).join('')}
          <div class="p-3"><label>Nom du magasinier <input name="signer" required maxlength="120" value="${esc(env.profile()?.name||'')}" class="rounded border p-2"></label><button class="ml-3 rounded-xl bg-teal-700 px-5 py-3 text-sm font-black text-white">Valider et signer la remise</button></div></form>
          <button type="button" data-delete-index="${index}" class="rounded-lg border border-red-300 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50">Supprimer / annuler ce bon</button>
          <p data-row-status="${index}" role="status" class="text-sm text-red-700"></p>
        </article>`;
      }).join('') || '<div class="rounded-2xl border border-dashed p-10 text-center text-slate-500">Aucun bon approuvé sans signature magasinier.</div>'}</div>
    </div>`;

    container.querySelector('[data-date-filter]')?.addEventListener('change', event => render(container, event.target.value || todayDateValue()));
    container.querySelector('[data-refresh]')?.addEventListener('click', () => enter(container, date));
    container.querySelectorAll('[data-regularize-form]').forEach(form => form.addEventListener('submit', event => { event.preventDefault(); regularize(form.dataset.requestKey, form, container, date); }));
    container.querySelectorAll('[data-delete-index]').forEach(button => button.addEventListener('click', () => cancelBon(Number(button.dataset.deleteIndex), container, date)));
  }

  async function enter(container, selectedDate = todayDateValue()) {
    if (busy || env?.profile?.()?.role !== 'Magasinier') return;
    const token = ++generation;
    container.innerHTML = '<p class="p-8 text-center">Chargement des bons à régulariser…</p>';
    try {
      await env.refresh();
      if (token === generation && container.isConnected) render(container, selectedDate);
    } catch (error) {
      if (token === generation && container.isConnected) {
        container.innerHTML = `<p class="m-5 rounded-xl bg-red-50 p-5 text-red-800">Chargement impossible : ${esc(error.message)}</p>`;
      }
    }
  }

  async function regularize(requestKey, form, container, selectedDate) {
    if (busy || env?.profile?.()?.role !== 'Magasinier') return;
    const bon = pendingBons(selectedDate).find(row => String(row._dbKey || row.id) === String(requestKey));
    if (!bon) return render(container, selectedDate);
    requestKey = bon._dbKey || bon.id;
    if (!requestKey) return;
    const items = remainingItems(bon).map(row => ({...row, quantity:Number(form.querySelector(`[data-qty="${row.index}"]`)?.value||0)})).filter(row=>row.quantity>0).map(row=>({index:row.index,quantity:row.quantity}));
    const unavailable_items=Array.from(form.querySelectorAll('[data-unavailable]:checked'),input=>Number(input.dataset.unavailable));
    const summary = remainingItems(bon).map(({item, remaining}) => `• ${item.label || 'Article'} (${item.op || bon.op || 'stock'}) : ${remaining}`).join('\n');
    if (!items.length && !unavailable_items.length) return global.alert('Saisissez une quantité à servir ou indiquez un matériel indisponible.');
    if (!global.confirm(`Valider le service du bon ${reference(bon)} ? Les quantités servies seront déduites du stock et les articles cochés indisponibles seront clôturés comme non servis.`)) return;

    busy = true;
    const token = generation;
    const status = container.querySelector(`[data-row-status="${index}"]`);
    const buttons = Array.from(container.querySelectorAll('[data-regularize-index], [data-refresh]'));
    buttons.forEach(button => { button.disabled = true; });
    try {
      const signature = await global.BonSignatures.capture('Signature du magasinier — régularisation de remise', form.elements.signer.value || env.profile()?.name || '');
      if (!signature || token !== generation) return;
      const { error } = await env.client().rpc('dispense_stock_bon_signed_v2', {
        request_key: String(requestKey), items, unavailable_items, signer_name: signature.name, signature_image: signature.image,
      });
      if (error) throw error;
      await env.refresh();
      if (token === generation && container.isConnected) {
        render(container, selectedDate);
        global.alert(`Remise signée et stock débité pour ${reference(bon)}.`);
      }
    } catch (error) {
      if (token === generation && status?.isConnected) status.textContent = error.message || 'Régularisation impossible.';
    } finally {
      busy = false;
      buttons.forEach(button => { if (button.isConnected) button.disabled = false; });
    }
  }

  async function cancelBon(index, container, selectedDate) {
    if (busy || env?.profile?.()?.role !== 'Magasinier') return;
    const bon = pendingBons(selectedDate)[index];
    if (!bon) return render(container, selectedDate);
    const requestKey = bon._dbKey || bon.id;
    if (!requestKey) return;
    const confirmed = global.confirm(`Supprimer / annuler le bon ${reference(bon)} ? Le bon restera dans la trace d’audit. Le stock débité par le gestionnaire sera restauré uniquement pour les quantités qui n’ont pas encore été remises.`);
    if (!confirmed) return;

    busy = true;
    const token = generation;
    const buttons = Array.from(container.querySelectorAll('[data-delete-index], [data-regularize-form] button, [data-refresh]'));
    buttons.forEach(button => { button.disabled = true; });
    const status = container.querySelector(`[data-row-status="${index}"]`);
    try {
      const { error } = await env.client().rpc('cancel_storekeeper_pending_bon', {
        request_key: String(requestKey),
        expected_bon_id: String(bon.id || ''),
        expected_manager_debit_at: bon.managerDebitAt || null,
      });
      if (error) throw error;
      await env.refresh();
      if (token === generation && container.isConnected) {
        render(container, selectedDate);
        global.alert(`Bon ${reference(bon)} annulé. Le débit non remis a été restitué au stock; une trace d’audit est conservée.`);
      }
    } catch (error) {
      if (token === generation && status?.isConnected) status.textContent = error.message || 'Suppression impossible.';
    } finally {
      busy = false;
      buttons.forEach(button => { if (button.isConnected) button.disabled = false; });
    }
  }

  global.StorekeeperBacklog = {
    setup: config => { env = config; },
    enter,
    render,
    isBusy: () => busy,
    stop: () => { generation++; },
  };
})(window);
