/* Firebase transport: tenant-filtered reads and changes addressed by stable keys. */
(function (global) {
  const collections = ['stock', 'sorties', 'demandes', 'techDemandes', 'retours', 'notifications', 'consumptionArchives', 'platformAuditLogs', 'companies', 'users'];
  const settings = ['materialTypes', 'scansDuJour', 'derniereDateScan', 'lastConsumptionArchiveKey'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const clean = value => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key, v]) => key !== '_dbKey' && key !== 'temporary_password' && v !== undefined)
      .map(([key, v]) => [key, clean(v)]));
    return value;
  };
  const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  class SecureStore {
    constructor(db, onChange, onDenied) {
      this.db = db; this.onChange = onChange; this.onDenied = onDenied;
      this.generation = 0; this.stop();
    }
    stop() {
      this.generation++;
      for (const [ref, callback] of this.listeners || []) ref.off('value', callback);
      this.listeners = []; this.profile = null; this.uid = null; this.pending = null;
      this.raw = {}; this.ready = false;
    }
    async connect(user) {
      if (!user) throw new Error('Connexion requise.');
      if (this.uid === user.uid && this.pending) return this.pending;
      this.stop(); this.uid = user.uid;
      const generation = this.generation;
      this.pending = this.load(user, generation).catch(error => {
        if (this.generation === generation) this.stop();
        throw error;
      });
      return this.pending;
    }
    async load(user, generation) {
      const ref = this.db.ref('auth_profiles/' + user.uid);
      const profile = (await ref.once('value')).val();
      if (generation !== this.generation) throw new Error('Session remplacée.');
      if (!profile || profile.is_active !== true || !profile.company_id) throw new Error('Compte non autorisé ou suspendu.');
      this.profile = profile;
      const isAdmin = profile.role === 'SUPER_ADMIN';
      const refs = collections.map(name => {
        let query = this.db.ref('itc_data/' + name);
        if (!isAdmin) query = query.orderByChild('company_id').equalTo(profile.company_id);
        return [name, query];
      });
      refs.push(['settings', this.db.ref('tenant_settings/' + profile.company_id)]);
      await Promise.all(refs.map(async ([name, query]) => {
        const snapshot = await query.once('value');
        if (generation === this.generation) this.raw[name] = snapshot.val() || {};
      }));
      if (generation !== this.generation) throw new Error('Session remplacée.');
      this.ready = true;
      for (const [name, query] of refs) {
        const callback = snapshot => {
          if (generation !== this.generation) return;
          this.raw[name] = snapshot.val() || {};
          this.onChange(this.value());
        };
        this.listeners.push([query, callback]);
        query.on('value', callback, error => this.deny(error, generation));
      }
      const profileChanged = snapshot => {
        const next = snapshot.val();
        if (!next || ['role', 'company_id', 'is_active'].some(key => next[key] !== profile[key])) {
          this.deny(new Error('Vos droits ont changé. Veuillez vous reconnecter.'), generation);
        }
      };
      this.listeners.push([ref, profileChanged]); ref.on('value', profileChanged, e => this.deny(e, generation));
      if (!isAdmin) {
        const branding = this.db.ref('tenant_branding/' + profile.company_id);
        const callback = snapshot => {
          if (snapshot.val()?.status !== 'active') this.deny(new Error('Entreprise suspendue.'), generation);
        };
        this.listeners.push([branding, callback]); branding.on('value', callback, e => this.deny(e, generation));
      }
      return this.value();
    }
    deny(error, generation) {
      if (generation !== this.generation) return;
      this.stop(); this.onDenied(error);
    }
    value() {
      const data = {};
      for (const name of collections) data[name] = Object.entries(this.raw[name] || {})
        .filter(([, row]) => row && typeof row === 'object')
        .map(([key, row]) => ({...clone(row), _dbKey: key}))
        .sort((a, b) => (a._order ?? (Number(a._dbKey) || 0)) - (b._order ?? (Number(b._dbKey) || 0)));
      for (const key of settings) data[key] = clone(this.raw.settings?.[key] ?? (['materialTypes', 'scansDuJour'].includes(key) ? [] : null));
      return data;
    }
    async save(data) {
      if (!this.ready || !this.profile) throw new Error('Données non chargées. Reconnectez-vous.');
      const updates = {};
      const profile = this.profile;
      for (const name of collections) {
        const before = this.raw[name] || {};
        const seen = new Set();
        const rows = data[name] || [];
        for (const [index, row] of rows.entries()) {
          if (!row || typeof row !== 'object') continue;
          const key = row._dbKey || this.db.ref('itc_data/' + name).push().key;
          if (seen.has(key)) throw new Error('Clé de donnée dupliquée : ' + name);
          seen.add(key); row._dbKey = key;
          const next = clean(row);
          next.company_id = name === 'companies' ? next.id : (next.company_id || (profile.role === 'SUPER_ADMIN' ? 'COMP-ITC-LEGACY' : profile.company_id));
          row.company_id = next.company_id;
          const previous = before[key];
          if (!previous && row._order === undefined) {
            const order = r => r?._order ?? (Number(r?._dbKey) || 0);
            const left = rows[index - 1], right = rows[index + 1];
            row._order = left && right ? (order(left) + order(right)) / 2 : left ? order(left) + 1 : right ? order(right) - 1 : 0;
            next._order = row._order;
          }
          if (equal(previous, next)) continue;
          const path = 'itc_data/' + name + '/' + key;
          if (!previous) updates[path] = next;
          else for (const field of new Set([...Object.keys(previous), ...Object.keys(next)])) {
            if (!equal(previous[field], next[field])) updates[path + '/' + field] = next[field] ?? null;
          }
          if (name === 'users' && next.uid && (!previous || ['uid', 'email', 'role', 'company_id', 'is_active', 'account_status'].some(k => !equal(previous[k], next[k])))) {
            updates['auth_profiles/' + next.uid] = {
              uid: next.uid, email: next.email, role: next.role, company_id: next.company_id,
              is_active: next.is_active === true, account_status: next.account_status || (next.is_active ? 'active' : 'suspended'),
              user_id: next.id, updated_at: new Date().toISOString(),
            };
            if (previous?.uid && previous.uid !== next.uid) updates['auth_profiles/' + previous.uid] = null;
          }
          if (name === 'companies') updates['tenant_branding/' + next.id] = {
            id: next.id, name: next.name || 'Entreprise', logo_url: next.logo_url || 'assets/saas-logo.svg', status: next.status || 'active',
          };
        }
        for (const [key, previous] of Object.entries(before)) {
          if (!previous || seen.has(key)) continue;
          updates['itc_data/' + name + '/' + key] = null;
          if (name === 'users' && previous.uid) updates['auth_profiles/' + previous.uid] = null;
        }
      }
      for (const key of settings) {
        if (!equal(this.raw.settings?.[key], data[key])) updates['tenant_settings/' + profile.company_id + '/' + key] = clean(data[key] ?? null);
      }
      if (Object.keys(updates).length) await this.db.ref().update(updates);
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {SecureStore, clean, collections, settings};
  else global.SecureStore = SecureStore;
})(typeof window === 'undefined' ? globalThis : window);
