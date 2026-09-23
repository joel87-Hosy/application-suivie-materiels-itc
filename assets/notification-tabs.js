(function(global){
  'use strict';
  const sections=['trafic-audit','coord-demandes-tech','bons-signes','tech-mes-demandes','demandes-coordonnatrice','gestion-retours','reception','transferts-stocks','validation-bons'];
  const legacyBadges={'trafic-audit':'notif-superviseur','coord-demandes-tech':'notif-coord','tech-mes-demandes':'notif-tech','demandes-coordonnatrice':'notif-gest-coord'};
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  function section(notification,user){
    if(sections.includes(notification.section))return notification.section;
    const role=normalize(user?.role),message=normalize(notification.message);
    if(['SUPERVISEUR','SUPER_ADMIN','DG'].includes(role))return 'trafic-audit';
    if(['VALIDATEUR','VALIDATRICE'].includes(role))return 'validation-bons';
    if(role==='TECHNICIEN')return 'tech-mes-demandes';
    if(['COORDINATEUR','COORDINATRICE','SUPERVISEUR TERRAIN'].includes(role))return /VOTRE COMMANDE|SIGNE|LIVREE/.test(message)?'bons-signes':'coord-demandes-tech';
    if(role==='GESTIONNAIRE'){
      if(/TRANSFERT|STOCK_TRANSFER/.test(message))return 'transferts-stocks';
      if(/RETOUR/.test(message))return 'gestion-retours';
      if(/ENTREE|RECEPTION/.test(message))return 'reception';
      return 'demandes-coordonnatrice';
    }
    return null;
  }
  function unread(notifications,user,target){
    if(user?.id==null)return [];
    return (notifications||[]).filter(n=>n && String(n.userId)===String(user.id) && !n.lu &&
      (!n.company_id || n.company_id===user.company_id) && (!target || section(n,user)===target));
  }
  function update(document,notifications,user){
    // Menus may be created after login. Attach badges without rebuilding a view.
    document.querySelectorAll('aside [onclick], #menu-validator button').forEach(button=>{
      const target=button.dataset.notificationSection || /showSection\(['"]([^'"]+)['"]\)/.exec(button.getAttribute('onclick')||'')?.[1];
      if(!sections.includes(target))return;
      let badge=button.querySelector('.notification-badge');
      if(!badge){badge=document.createElement('span');badge.className='notification-badge hidden ml-2';button.append(badge);}
      badge.dataset.notificationSection=target;
      badge.setAttribute('aria-live','polite');
    });
    const counts=Object.fromEntries(sections.map(target=>[target,unread(notifications,user,target).length]));
    const set=(badge,count)=>{if(!badge)return;badge.innerText=count;badge.hidden=count===0;badge.classList.toggle('hidden',count===0);if(badge.style)badge.style.display=count===0?'none':'';};
    for(const [target,id] of Object.entries(legacyBadges))set(document.getElementById(id),counts[target]);
    document.querySelectorAll('.notification-badge[data-notification-section]').forEach(badge=>set(badge,counts[badge.dataset.notificationSection]||0));
  }
  global.NotificationTabs={sections,section,unread,update};
})(window);
