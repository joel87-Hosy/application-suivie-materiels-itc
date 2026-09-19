import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import { canRead, sourceFromSortie, transition } from './core.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const validKey = (value: unknown) => typeof value === 'string' && /^[\p{L}\p{N}_-]{1,100}$/u.test(value);
const rows = (value: unknown) => Object.values((value && typeof value === 'object' ? value : {}) as Record<string, any>);

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Connexion requise.' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: auth, error: authError } = await userClient.auth.getUser();
    if (authError || !auth.user) return json({ error: 'Session Supabase invalide.' }, 401);
    const admin = createClient(url, service);
    const { data: profile, error: profileError } = await admin.from('app_profiles').select('*').eq('user_id', auth.user.id).maybeSingle();
    if (profileError || !profile?.is_active || !profile.company_id) return json({ error: 'Compte non autorisé ou suspendu.' }, 403);
    const actor = { ...profile.profile, uid: profile.firebase_uid || auth.user.id, user_id: auth.user.id, email: auth.user.email, company_id: profile.company_id, role: profile.role, is_active: profile.is_active, control_scopes: profile.control_scopes };
    const command = await request.json().catch(() => ({}));
    const workflowEnabled=true;
    const {data: managerRows,error: managerError}=await admin.from('app_profiles').select('user_id,role,is_active,company_id,control_scopes,profile').eq('company_id',profile.company_id).eq('role','Gestionnaire').eq('is_active',true);
    if(managerError)throw managerError;
    const assignedManager=(managerRows||[]).find(row=>row.user_id===command.managerUid);
    const { data: stockRows } = await admin.from('app_records').select('record_key,payload').eq('collection', 'stock').eq('company_id', profile.company_id);
    const { data: userRows } = await admin.from('app_records').select('record_key,payload').eq('collection', 'users').eq('company_id', profile.company_id);
    const { data: sortieRows } = await admin.from('app_records').select('record_key,payload').eq('collection', 'sorties').eq('company_id', profile.company_id);
    const stock = (stockRows || []).map(row => ({ ...row.payload, _dbKey: row.record_key }));
    const users = (userRows || []).map(row => ({ ...row.payload, _dbKey: row.record_key }));
    const sorties = (sortieRows || []).map(row => ({ ...row.payload, _dbKey: row.record_key }));
    if (command.action === 'overview') {
      const ops = new Set(stock.map(row => row.op === 'ITC' ? 'ITC-B01' : row.op).filter(Boolean));
      Object.keys(profile.control_scopes || {}).forEach(op => ops.add(op));
      const { data: stores } = await admin.from('cable_offcut_stores').select('op,state').eq('company_id', profile.company_id);
      const result: Record<string, any> = {};
      for (const row of stores || []) if (canRead(actor, row.op)) {
        const state = structuredClone(row.state || {}); delete state.commands;
        if (actor.role === 'Technicien') {
          state.returns = Object.fromEntries(Object.entries(state.returns || {}).filter(([, item]: any) => item.technicienUid === actor.uid));
          state.requests = Object.fromEntries(Object.entries(state.requests || {}).filter(([, item]: any) => item.technicienUid === actor.uid));
          state.events = Object.fromEntries(Object.entries(state.events || {}).filter(([, item]: any) => item.actorUid === actor.uid));
        }
        result[row.op] = state;
      }
      for (const op of ops) if (!result[op] && canRead(actor, op)) result[op] = { lots: {}, returns: {}, requests: {}, events: {} };
      const sources: any[] = [];
      if (actor.role === 'Technicien') for (const sortie of sorties) for (const [index, item] of (sortie.items || []).entries()) {
        const material = stock.find(row => row.op === (item.op || sortie.op) && row.label === item.label);
        const source = sourceFromSortie(sortie, { ...item, type: item.type || material?.type }, actor, sortie._dbKey, index);
        if (source) sources.push(source);
      }
      return json({ stores: result, sources, workflowEnabled, userId:auth.user.id, managers:(managerRows||[]).map(m=>({uid:m.user_id,name:m.profile?.name||m.role,scopes:m.control_scopes})) });
    }
    if (!validKey(command.op) || !validKey(command.commandId) || !canRead(actor, command.op)) return json({ error: 'Stock non autorisé.' }, 403);
    let source = null;
    if (command.action === 'return' && !command.issueId) {
      const sortie = sorties.find(row => row._dbKey === command.sortieKey);
      const item = sortie?.items?.[command.itemIndex];
      if (sortie && item) source = sourceFromSortie(sortie, item, actor, command.sortieKey, command.itemIndex);
    }
    for(let attempt=0;attempt<4;attempt++) {
      const {data:store,error:storeError}=await admin.from('cable_offcut_stores').select('state').eq('company_id',profile.company_id).eq('op',command.op).maybeSingle();
      if(storeError)throw storeError;
      const next=await transition(store?.state||{},command,actor,{op:command.op,company:profile.company_id,now:new Date().toISOString(),id:command.commandId,source,workflowEnabled,assignedManager});
      const {data:saved,error:saveError}=await admin.rpc('save_offcut_state',{company:profile.company_id,operator:command.op,previous_state:store?.state??null,next_state:next});
      if(saveError)throw saveError;
      if(saved)return json({ok:true});
    }
    throw new Error('Le stock a changé. Actualisez puis réessayez.');
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Erreur du service Supabase.' }, 400);
  }
});
