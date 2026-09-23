(function (global) {
  const collections = ['stock', 'stockMovements', 'sorties', 'demandes', 'techDemandes', 'retours', 'notifications', 'consumptionArchives', 'platformAuditLogs', 'companies', 'users'];
  const settings = ['materialTypes', 'scansDuJour', 'derniereDateScan', 'lastConsumptionArchiveKey'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const clean = value => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key, item]) => key !== '_dbKey' && key !== 'temporary_password' && item !== undefined)
      .map(([key, item]) => [key, clean(item)]));
    return value;
  };
  const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const key = () => global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  class SupabaseStore {
    constructor(client, onChange, onDenied) {
      this.client = client;
      this.onChange = onChange;
      this.onDenied = onDenied;
      this.timer = null;
      this.generation = 0;
      this.stop();
    }
    stop() {
      this.generation++;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.profile = null;
      this.uid = null;
      this.pending = null;
      this.raw = {};
      this.notificationCompanies = {};
      this.ready = false;
    }
    async connect(user) {
      if (!user) throw new Error('Connexion requise.');
      this.stop();
      this.uid = user.id || user.uid;
      const generation = this.generation;
      this.pending = this.load(generation).catch(error => {
        if (this.generation === generation) this.stop();
        throw error;
      });
      return this.pending;
    }
    async load(generation) {
      const { data: profile, error: profileError } = await this.client
        .from('app_profiles').select('*').eq('user_id', this.uid).maybeSingle();
      if (profileError) throw profileError;
      if (generation !== this.generation) throw new Error('Session remplacée.');
      if (!profile || !profile.is_active || !profile.company_id) throw new Error('Compte non autorisé ou suspendu.');
      this.profile = {
        ...profile.profile,
        uid: profile.firebase_uid || this.uid,
        company_id: profile.company_id,
        role: profile.role,
        is_active: profile.is_active,
        controlScopes: profile.control_scopes,
        controlScopeKeys: profile.control_scope_keys,
      };
      // The server enforces validation for every company, including new tenants.
      this.profile.validatorWorkflowEnabled = true;
      await this.read(generation);
      this.ready = true;
      // Refresh only after an explicit action; background polling destroys drafts.
      return this.value();
    }
    async read(generation) {
      const [records, { data: settingRows, error: settingsError }] = await Promise.all([
        this.readAllRecords(generation),
        this.client.from('app_settings').select('*').eq('company_id', this.profile.company_id),
      ]);
      if (settingsError) throw settingsError;
      if (generation !== this.generation) return;
      this.raw = {};
      this.notificationCompanies = {};
      for (const row of records || []) {
        this.raw[row.collection] ||= {};
        this.raw[row.collection][row.record_key] = row.payload;
        if (row.collection === 'notifications') this.notificationCompanies[row.record_key] = row.company_id;
      }
      this.raw.settings = Object.fromEntries((settingRows || []).map(row => [row.setting_key, row.value]));
      if (this.ready) this.onChange(this.value());
    }
    async readAllRecords(generation) {
      const records = [], seen = new Set();
      const company = this.profile.company_id, isAdmin = this.profile.role === 'SUPER_ADMIN';
      // PostgREST caps a response (normally 1000 rows). Notifications and
      // histories must not crowd stock cards out of the application snapshot.
      for (;;) {
        if (generation !== this.generation) throw new Error('Session remplacée.');
        let query = this.client.from('app_records').select('*')
          .order('collection', {ascending:true}).order('record_key', {ascending:true})
          .range(records.length, records.length + 499);
        if (!isAdmin) query = query.eq('company_id', company);
        const {data, error} = await query;
        if (error) throw error;
        if (!data?.length) return records;
        for (const row of data) {
          const identity = JSON.stringify([row.collection, row.record_key]);
          if (seen.has(identity)) throw new Error('Les données ont changé pendant le chargement. Actualisez la page.');
          seen.add(identity); records.push(row);
        }
        // Advance by the number actually received, including servers whose
        // configured row limit is lower than the requested page size.
      }
    }
    deny(error, generation) {
      if (generation !== this.generation) return;
      this.stop();
      this.onDenied(error);
    }
    value() {
      const data = {};
      for (const name of collections) data[name] = Object.entries(this.raw[name] || {})
        .filter(([, row]) => row && typeof row === 'object')
        .map(([recordKey, row]) => ({ ...clone(row), _dbKey: recordKey }))
        .sort((a, b) => (a._order ?? (Number(a._dbKey) || 0)) - (b._order ?? (Number(b._dbKey) || 0)));
      for (const setting of settings) data[setting] = clone(this.raw.settings?.[setting] ?? (['materialTypes', 'scansDuJour'].includes(setting) ? [] : null));
      return data;
    }
    async markNotificationsRead(recordKeys) {
      if (!this.ready || !this.profile || this.profile.id == null) return [];
      const generation = this.generation;
      const selected = recordKeys === undefined ? null : new Set(recordKeys);
      const changes = Object.entries(this.raw.notifications || {})
        .filter(([recordKey, row]) => (!selected || selected.has(recordKey)) && String(row.userId) === String(this.profile.id) && !row.lu &&
          (this.notificationCompanies[recordKey] ?? row.company_id) === this.profile.company_id)
        .map(([record_key, row]) => ({collection:'notifications', record_key, company_id:this.profile.company_id,
          previous:clone(row), payload:{...clone(row), lu:true}}));
      if (!changes.length) return [];
      const {error} = await this.client.rpc('save_app_changes', {changes});
      if (error) throw error;
      if (generation !== this.generation) return [];
      const updated = [];
      for (const row of changes) {
        if (equal(this.raw.notifications?.[row.record_key], row.previous)) {
          this.raw.notifications[row.record_key] = row.payload;
          updated.push(row.record_key);
        }
      }
      return updated;
    }
    async save(data) {
      const control = global.ControlCore;
      if (!this.ready || !this.profile) throw new Error('Données non chargées. Reconnectez-vous.');
      if (!Array.isArray(control?.scopedCollections)) throw new Error('Le module des stocks est incomplet. Utilisez le bouton de mise à jour de l’application, puis réessayez.');
      if (this.profile.role === 'Contrôleur') throw new Error('Utilisez le module Contrôle pour enregistrer vos vérifications.');
      const rows = [];
      for (const name of collections) {
        for (const row of data[name] || []) {
          if (!row || typeof row !== 'object') continue;
          const recordKey = row._dbKey || key();
          const next = clean(row);
          if (equal(next, this.raw[name]?.[recordKey])) continue;
          next.company_id = name === 'companies' ? next.id : (next.company_id || (this.profile.role === 'SUPER_ADMIN' ? 'COMP-ITC-LEGACY' : this.profile.company_id));
          if (control.scopedCollections.includes(name)) {
            next.op = control.operator(next.op);
            next.scope_key = control.scopeKey(next.company_id, next.op);
          }
          rows.push({collection: name, record_key: recordKey, company_id: next.company_id, payload: next, previous: this.raw[name]?.[recordKey] ?? null});
        }
      }
      if (rows.length) {
        const {error} = await this.client.rpc('save_app_changes', {changes: rows});
        if (error) throw error;
      }
      const settingRows = settings.filter(setting => !equal(data[setting], this.raw.settings?.[setting]))
        .map(setting => ({company_id: this.profile.company_id, setting_key: setting, value: clean(data[setting] ?? null), updated_at: new Date().toISOString()}));
      if (settingRows.length) {
        const {error: settingsError} = await this.client.from('app_settings').upsert(settingRows, {onConflict: 'company_id,setting_key'});
        if (settingsError) throw settingsError;
      }
      await this.read(this.generation);
    }
  }
  global.SupabaseStore = SupabaseStore;
})(window);
