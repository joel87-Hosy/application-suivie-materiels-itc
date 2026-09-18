// Personal account settings, available to every authenticated role.
function renderMonProfil(container) {
  if (!currentUser) return;
  const u = currentUser;
  const field = (id, label, value, type = 'text', extra = '') => `<label class="block text-sm font-bold">${label}<input id="${id}" type="${type}" value="${escapeHtml(value || '')}" class="block w-full border rounded-xl p-3 mt-2 font-normal" ${extra}></label>`;
  container.innerHTML = `<div class="max-w-3xl mx-auto space-y-6">
    <div class="bg-indigo-700 text-white rounded-2xl p-6"><h2 class="text-xl font-bold">Mon profil</h2><p class="mt-2">${escapeHtml(u.name || '')} · ${escapeHtml(u.role || '')}</p></div>
    ${u.must_change_password ? '<p class="bg-amber-50 text-amber-900 p-4 rounded-xl">Personnalisez votre mot de passe initial dans la rubrique Sécurité ci-dessous.</p>' : ''}
    <section class="bg-white rounded-2xl p-6 border space-y-4"><h3 class="font-bold text-lg">Informations du compte</h3>
    <p>Identifiant : <strong>${escapeHtml(u.username || u.email || '')}</strong></p>
    ${u.username ? `<p>Équipe : <strong>${escapeHtml(u.name || '')}</strong></p><p class="text-sm text-slate-500">Le nom de l’équipe reste celui affiché sur les bons. Contactez votre gestionnaire pour le modifier.</p>` : ''}
    <p>Entreprise : ${escapeHtml(u.company_name || u.company_id || 'Non renseignée')}</p>
    <p>Périmètre : ${escapeHtml(Array.isArray(u.managedOps) ? u.managedOps.join(', ') : 'Non renseigné')}</p>
    <form onsubmit="saveMonProfil(event)" class="space-y-4">
      ${field('profile-name', u.username ? 'Nom du contact de l’équipe' : 'Nom complet', u.username ? u.contact_name : u.name, 'text', 'required maxlength="120" autocomplete="name"')}
      ${field('profile-phone', 'Téléphone de contact', u.phone, 'tel', 'maxlength="40" autocomplete="tel"')}
      ${field('profile-contact-email', 'Email de contact (facultatif)', u.contact_email, 'email', 'maxlength="254" autocomplete="email"')}
      <p class="text-sm text-slate-500">L’email de contact ne modifie pas votre identifiant de connexion.</p>
      <button class="bg-indigo-600 text-white rounded-xl px-5 py-3">Enregistrer mon profil</button>
      <p id="profile-status" role="status" aria-live="polite"></p>
    </form></section>
    <section class="bg-white rounded-2xl p-6 border space-y-4"><h3 class="font-bold text-lg">Sécurité — Modifier mon mot de passe</h3>
    <form onsubmit="changeMonProfilPassword(event)" class="space-y-4">
      ${field('profile-current-password', 'Mot de passe actuel', '', 'password', 'required autocomplete="current-password"')}
      ${field('profile-new-password', 'Nouveau mot de passe (8 caractères minimum)', '', 'password', 'required minlength="8" autocomplete="new-password"')}
      ${field('profile-confirm-password', 'Confirmer le nouveau mot de passe', '', 'password', 'required minlength="8" autocomplete="new-password"')}
      <label class="flex gap-2 text-sm"><input type="checkbox" onchange="this.form.querySelectorAll('[autocomplete*=password]').forEach(input => input.type = this.checked ? 'text' : 'password')">Afficher les mots de passe</label>
      <button class="bg-indigo-600 text-white rounded-xl px-5 py-3">Changer mon mot de passe</button>
      <p id="profile-password-status" role="status" aria-live="polite"></p>
    </form></section>
    <section class="bg-white rounded-2xl p-6 border space-y-3"><h3 class="font-bold text-lg">Notifications sur cet appareil</h3>
    <p class="text-sm text-slate-600">Recevez une notification système lorsque l’application est fermée : bon à signer, à valider ou matériel disponible.</p>
    <button type="button" onclick="enablePushNotifications(this)" class="bg-indigo-600 text-white rounded-xl px-5 py-3">Activer les notifications</button>
    <p id="push-notification-status" class="text-sm text-slate-600" role="status" aria-live="polite"></p></section></div>`;
}

async function getOwnProfileRef() {
  if (window.ITCSupabaseConfig?.client) {
    const client=window.ITCSupabaseConfig.client;
    return {update:async changes=>{const {error}=await client.rpc('update_own_profile',{changes});if(error)throw error;}};
  }
  const authUser = firebase.auth().currentUser;
  if (!authUser || !currentUser || (currentUser.uid && currentUser.uid !== authUser.uid)) throw new Error('Session expirée. Reconnectez-vous.');
  const entry = (appData.users || []).find(u => u.uid === authUser.uid);
  if (!entry?._dbKey) throw new Error('Profil introuvable. Contactez votre gestionnaire.');
  return db.ref('itc_data/users/' + entry._dbKey);
}

function profileErrorMessage(error) {
  const messages = {
    'auth/wrong-password': 'Le mot de passe actuel est incorrect.',
    'auth/invalid-credential': 'Le mot de passe actuel est incorrect.',
    'auth/invalid-login-credentials': 'Le mot de passe actuel est incorrect.',
    'auth/weak-password': 'Choisissez un mot de passe plus fort.',
    'auth/password-does-not-meet-requirements': 'Le mot de passe ne respecte pas les exigences de sécurité du compte.',
    'auth/too-many-requests': 'Trop de tentatives. Réessayez plus tard.',
    'auth/network-request-failed': 'Connexion indisponible. Réessayez.',
    'PERMISSION_DENIED': 'Enregistrement refusé. Contactez votre gestionnaire.',
  };
  return messages[error.code] || error.message || 'Impossible de terminer cette opération.';
}

async function saveMonProfil(event) {
  event.preventDefault();
  const form = event.target, button = form.querySelector('button');
  const status = document.getElementById('profile-status');
  button.disabled = true;
  status.textContent = 'Enregistrement…';
  try {
    const name = document.getElementById('profile-name').value.trim();
    if (!name) throw new Error('Renseignez votre nom.');
    const ref = await getOwnProfileRef();
    const changes = {phone: document.getElementById('profile-phone').value.trim(), contact_email: document.getElementById('profile-contact-email').value.trim(), updated_at: new Date().toISOString()};
    if (currentUser.username) changes.contact_name = name;
    else { changes.name = name; changes.full_name = name; }
    await ref.update(changes);
    Object.assign(currentUser, changes);
    updateUserInfo();
    status.textContent = 'Profil enregistré.';
  } catch (error) { status.textContent = profileErrorMessage(error); }
  finally { button.disabled = false; }
}

async function changeMonProfilPassword(event) {
  event.preventDefault();
  const form = event.target, button = form.querySelector('button');
  const status = document.getElementById('profile-password-status');
  button.disabled = true;
  let passwordChanged = false;
  status.textContent = 'Vérification…';
  try {
    const oldPassword = document.getElementById('profile-current-password').value;
    const newPassword = document.getElementById('profile-new-password').value;
    if (newPassword.length < 8) throw new Error('Utilisez au moins 8 caractères.');
    if (newPassword !== document.getElementById('profile-confirm-password').value) throw new Error('Les nouveaux mots de passe ne correspondent pas.');
    if (newPassword === oldPassword) throw new Error('Choisissez un mot de passe différent du mot de passe actuel.');
    const ref = await getOwnProfileRef();
    const supabase=window.ITCSupabaseConfig?.client;
    if (supabase) {
      const {data,error}=await supabase.auth.getUser(); if(error)throw error;
      const checked=await supabase.auth.signInWithPassword({email:data.user.email,password:oldPassword});
      if(checked.error)throw checked.error;
      const changed=await supabase.auth.updateUser({password:newPassword});if(changed.error)throw changed.error;
    } else {
      const user = firebase.auth().currentUser;
      await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, oldPassword));
      await user.updatePassword(newPassword);
    }
    passwordChanged = true;
    form.reset();
    form.querySelectorAll('[autocomplete*=password]').forEach(input => input.type = 'password');
    await ref.update({must_change_password: false, password_changed_at: new Date().toISOString()});
    currentUser.must_change_password = false;
    currentUser.temporary_password = null;
    status.textContent = 'Mot de passe modifié. Utilisez votre nouveau mot de passe à la prochaine connexion.';
  } catch (error) {
    status.textContent = passwordChanged ? 'Votre mot de passe a été modifié, mais le statut du profil n’a pas pu être actualisé. Utilisez le nouveau mot de passe à la prochaine connexion.' : profileErrorMessage(error);
  } finally { button.disabled = false; }
}
