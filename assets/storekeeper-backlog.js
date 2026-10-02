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
      return { index, item, requested, delivered, remaining: requested - delivered };
    }).filter(row => Number.isFinite(row.remaining) && row.remaining > 0);
  }

  function pendingBons() {
    const data = env?.data?.() || {};
    return (data.demandes || []).filter(bon => {
      const status = normalizedStatus(bon);
      return ['EN ATTENTE MAGASINIER', 'PARTIELLEMENT SERVI'].includes(status) &&
        Boolean(bon.managerSignedAt) && !alreadySigned(bon) && remainingItems(bon).length > 0;
    }).sort((a, b) => String(a.managerSignedAt || a.date || '').localeCompare(String(b.managerSignedAt || b.date || '')));
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

  function render(container) {
    if (!container || env?.profile?.()?.role !== 'Magasinier') return;
    const rows = pendingBons();
    container.innerHTML = `<div class="max-w-5xl mx-auto space-y-5 p-4">
      <header class="rounded-2xl bg-gradient-to-r from-indigo-800 to-teal-700 p-6 text-white">
        <p class="text-[10px] font-bold uppercase tracking-widest opacity-80">Régularisation des remises</p>
        <h2 class="mt-1 text-2xl font-black">Bons servis sans signature magasinier</h2>
        <p class="mt-3 text-sm">Bons approuvés qui attendent encore la confirmation du magasinier. Ouvrez un bon seulement si vous avez déjà remis physiquement les articles. La signature et le débit du stock seront enregistrés ensemble.</p>
        <button type="button" data-refresh class="mt-4 rounded-lg border border-white/60 px-4 py-2 text-sm font-bold">Actualiser la liste</button>
      </header>
      <p class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Les bons déjà marqués « Livrée » ne figurent pas ici : leur stock a peut-être déjà été débité. Cette liste montre uniquement les bons encore en attente de remise ou partiellement servis.</p>
      <p class="text-sm font-bold text-slate-600">${rows.length} bon(s) à vérifier</p>
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
          <div class="divide-y rounded-xl border">${items.map(({item, remaining, delivered}) => `<div class="flex flex-wrap justify-between gap-2 p-3 text-sm"><span class="font-semibold">${esc(item.label || 'Article sans nom')} <span class="text-slate-500">· ${esc(item.op || bon.op || '')}</span></span><span>À remettre : <b>${esc(remaining)}</b>${delivered ? ` · déjà enregistré : ${esc(delivered)}` : ''}</span></div>`).join('')}</div>
          <button type="button" data-regularize-index="${index}" data-request-key="${esc(key)}" class="rounded-xl bg-teal-700 px-5 py-3 text-sm font-black text-white hover:bg-teal-800">Confirmer la remise passée, signer et débiter le stock</button>
          <p data-row-status="${index}" role="status" class="text-sm text-red-700"></p>
        </article>`;
      }).join('') || '<div class="rounded-2xl border border-dashed p-10 text-center text-slate-500">Aucun bon approuvé sans signature magasinier.</div>'}</div>
    </div>`;

    container.querySelector('[data-refresh]')?.addEventListener('click', () => enter(container));
    container.querySelectorAll('[data-regularize-index]').forEach(button => {
      button.addEventListener('click', () => regularize(Number(button.dataset.regularizeIndex), container));
    });
  }

  async function enter(container) {
    if (busy || env?.profile?.()?.role !== 'Magasinier') return;
    const token = ++generation;
    container.innerHTML = '<p class="p-8 text-center">Chargement des bons à régulariser…</p>';
    try {
      await env.refresh();
      if (token === generation && container.isConnected) render(container);
    } catch (error) {
      if (token === generation && container.isConnected) {
        container.innerHTML = `<p class="m-5 rounded-xl bg-red-50 p-5 text-red-800">Chargement impossible : ${esc(error.message)}</p>`;
      }
    }
  }

  async function regularize(index, container) {
    if (busy || env?.profile?.()?.role !== 'Magasinier') return;
    const bon = pendingBons()[index];
    if (!bon) return render(container);
    const requestKey = bon._dbKey || bon.id;
    if (!requestKey) return;
    const items = remainingItems(bon).map(row => ({ index: row.index, quantity: row.remaining }));
    const summary = remainingItems(bon).map(({item, remaining}) => `• ${item.label || 'Article'} (${item.op || bon.op || 'stock'}) : ${remaining}`).join('\n');
    if (!items.length) return render(container);
    if (!global.confirm(`Confirmez-vous que cette remise a déjà été faite physiquement ? La signature magasinier sera ajoutée et le stock sera débité pour :\n${reference(bon)}\n${summary}`)) return;

    busy = true;
    const token = generation;
    const status = container.querySelector(`[data-row-status="${index}"]`);
    const buttons = Array.from(container.querySelectorAll('[data-regularize-index], [data-refresh]'));
    buttons.forEach(button => { button.disabled = true; });
    try {
      const signature = await global.BonSignatures.capture('Signature du magasinier — régularisation d’une remise passée', env.profile()?.name || '');
      if (!signature || token !== generation) return;
      const { error } = await env.client().rpc('dispense_stock_bon_signed', {
        request_key: String(requestKey), items, signer_name: signature.name, signature_image: signature.image,
      });
      if (error) throw error;
      await env.refresh();
      if (token === generation && container.isConnected) {
        render(container);
        global.alert(`Remise signée et stock débité pour ${reference(bon)}.`);
      }
    } catch (error) {
      if (token === generation && status?.isConnected) status.textContent = error.message || 'Régularisation impossible.';
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
