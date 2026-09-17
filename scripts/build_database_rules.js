// Keep the repeated tenant checks consistent. Run after changing this file.
const fs = require('fs');
const p = "root.child('auth_profiles').child(auth.uid)";
const role = `${p}.child('role').val()`;
const company = `${p}.child('company_id').val()`;
const active = `auth != null && ${p}.child('is_active').val() === true`;
const admin = `(${active} && ${role} === 'SUPER_ADMIN')`;
const member = `(${active} && ${p}.child('company_id').isString() && root.child('tenant_branding').child(${company}).child('status').val() === 'active')`;
const roles = names => '(' + names.map(n => `${role} === '${n}'`).join(' || ') + ')';
const staff = roles(['Superviseur', 'Gestionnaire', 'Coordinateur', 'Coordinatrice', 'Superviseur Terrain', 'Technicien']);
const managers = roles(['Superviseur', 'Gestionnaire', 'Coordinateur', 'Coordinatrice', 'Superviseur Terrain']);
const subordinate = snap => '(' + ['Contrôleur', 'Gestionnaire', 'Coordinateur', 'Coordinatrice', 'Superviseur Terrain', 'Technicien'].map(r => `${snap}.child('role').val() === '${r}'`).join(' || ') + ')';
const scope = `(!data.exists() || data.child('company_id').val() === ${company}) && (!newData.exists() || newData.child('company_id').val() === ${company})`;
const manageUser = `(${member} && ${role} === 'Superviseur' && ${scope} && (!data.exists() || ${subordinate('data')}) && (!newData.exists() || ${subordinate('newData')}))`;
const recordRead = `${admin} || (${member} && data.child('company_id').val() === ${company})`;
const listRead = `${admin} || (${member} && query.orderByChild === 'company_id' && query.equalTo === ${company})`;
const rules = {'.read': false, '.write': false};
rules.auth_profiles = {
  '$uid': {
    '.read': `auth != null && (auth.uid === $uid || ${admin})`,
    '.write': `${admin} || (${manageUser} && auth.uid !== $uid)`,
    '.validate': "newData.hasChildren(['uid', 'email', 'role', 'company_id', 'is_active']) && newData.child('uid').val() === $uid && newData.child('email').isString() && newData.child('company_id').isString() && newData.child('is_active').isBoolean() && (!data.exists() || newData.child('uid').val() === data.child('uid').val())",
    role: {'.validate': "newData.val() === 'SUPER_ADMIN' || newData.val() === 'Contrôleur' || newData.val() === 'Superviseur' || newData.val() === 'Gestionnaire' || newData.val() === 'Coordinateur' || newData.val() === 'Coordinatrice' || newData.val() === 'Superviseur Terrain' || newData.val() === 'Technicien'"},
    temporary_password: {'.validate': false},
  },
};
rules.tenant_branding = {'$companyId': {
  '.read': `${admin} || (${active} && ${company} === $companyId)`,
  '.write': admin,
  '.validate': "newData.hasChildren(['id', 'name', 'status']) && newData.child('id').val() === $companyId && (newData.child('status').val() === 'active' || newData.child('status').val() === 'suspended')",
}};
rules.tenant_settings = {'$companyId': {
  '.read': `${admin} || (${member} && ${company} === $companyId)`,
  '$field': {'.write': `${admin} || (${member} && ${company} === $companyId && ${staff})`},
}};
rules.push_subscriptions = {'$uid': {
  '.read': `auth != null && (auth.uid === $uid || ${admin})`,
  '$device': {
    '.write': `auth != null && auth.uid === $uid`,
    '.validate': "newData.hasChildren(['token','company_id','updatedAt']) && newData.child('token').isString() && newData.child('token').val().length <= 4096 && newData.child('company_id').val() === root.child('auth_profiles').child(auth.uid).child('company_id').val() && newData.child('updatedAt').isString()",
  },
}};
rules.itc_data = {};
for (const name of ['stock', 'stockMovements', 'sorties', 'demandes', 'techDemandes', 'retours', 'notifications', 'consumptionArchives', 'platformAuditLogs']) {
  let permission = ['stock', 'sorties', 'consumptionArchives'].includes(name) ? managers : staff;
  if (['demandes', 'techDemandes'].includes(name)) {
    const ownerField = name === 'techDemandes' ? 'technicienId' : 'demandeurOriginalId';
    const statusField = name === 'techDemandes' ? 'statut' : 'status';
    permission = `(${managers} || (${role} === 'Technicien' && !data.exists() && newData.exists() && ${p}.child('user_id').isNumber() && newData.child('${ownerField}').val() === ${p}.child('user_id').val() && newData.child('${statusField}').val() === 'EN ATTENTE COORDINATION'))`;
  }
  if (name === 'retours') permission = `(${managers} || (${role} === 'Technicien' && !data.exists() && newData.child('technicienUid').val() === auth.uid && newData.child('status').val() === 'EN ATTENTE'))`;
  if (name === 'notifications') permission = `(${staff} && !data.exists() && newData.child('actorUid').val() === auth.uid)`;
  if (name === 'platformAuditLogs') permission = `(${managers} && !data.exists())`;
  if (name === 'stockMovements') permission = `(${managers} && !data.exists() && newData.child('actorUid').val() === auth.uid)`;
  rules.itc_data[name] = {
    '.indexOn': ['company_id'], '.read': listRead,
    '$key': {
      '.read': recordRead,
      '.write': `${admin} || (${member} && ${permission} && ${scope})`,
      '.validate': "newData.hasChildren(['company_id']) && newData.child('company_id').isString()",
    },
  };
  if (name === 'notifications') rules.itc_data[name].$key.lu = {
    '.write': `${member} && data.parent().child('company_id').val() === ${company} && data.parent().child('userId').val() === ${p}.child('user_id').val()`,
    '.validate': 'newData.isBoolean()',
  };
}
rules.itc_data.companies = {
  '.indexOn': ['company_id'], '.read': listRead,
  '$key': {'.read': recordRead, '.write': admin, '.validate': "newData.hasChildren(['id', 'company_id', 'status']) && newData.child('id').val() === newData.child('company_id').val()"},
};
rules.itc_data.users = {
  '.indexOn': ['company_id'], '.read': listRead,
  '$key': {
    '.read': recordRead,
    '.write': `${admin} || ${manageUser}`,
    '.validate': "newData.hasChildren(['id', 'email', 'role', 'company_id', 'is_active']) && newData.child('email').isString() && newData.child('company_id').isString() && newData.child('is_active').isBoolean()",
    temporary_password: {'.validate': false},
  },
};
for (const field of ['name', 'full_name', 'contact_name', 'phone', 'contact_email', 'updated_at', 'must_change_password', 'password_changed_at']) {
  rules.itc_data.users.$key[field] = {
    '.write': `${active} && data.parent().child('uid').val() === auth.uid && (${admin} || ${member})`,
    // Account creators can require an initial password change; self-service users
    // can only clear this flag after the existing password-change workflow.
    '.validate': field === 'must_change_password' ? `newData.isBoolean() && (newData.val() === false || ${admin} || (${member} && ${role} === 'Superviseur' && newData.parent().child('company_id').val() === ${company}))` : 'newData.isString() && newData.val().length <= 254',
  };
}
require('./control_database_rules')({rules, p, role, company, member, admin, listRead, recordRead});
fs.writeFileSync('database.rules.json', JSON.stringify({rules}, null, 2) + '\n');
