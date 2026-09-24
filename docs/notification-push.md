# Notifications Supabase et pastilles

La pastille Commandes compte uniquement les notifications non lues du compte et de cet onglet. Après rechargement, elle est recalculée même quand aucun marquage n’est nécessaire : l’ancien cumul disparaît alors. Le client utilise `mark_app_notifications_read` et, si cette fonction manque (`PGRST202`), `save_app_changes` avec contrôle de concurrence. Un échec de sauvegarde laisse la notification non lue et affiche un message dans l’onglet.

## Mise en service

1. Appliquer `supabase/migrations/202609230004_notification_read_receipts.sql` (réexécutable) puis `202609240002_push_subscriptions.sql` dans l’éditeur SQL Supabase. Recharger le cache si nécessaire avec `NOTIFY pgrst, 'reload schema';`.
2. Configurer les secrets de la fonction Supabase : `FCM_SERVICE_ACCOUNT` contient le JSON du compte de service Firebase du projet `itc-erp` autorisé à envoyer des messages FCM ; `PUSH_WEBHOOK_SECRET` contient un secret aléatoire fort. Ne jamais mettre ces secrets dans les fichiers publics.
3. Déployer : `supabase functions deploy notification-push --no-verify-jwt`. La fonction vérifie elle-même l’en-tête secret `x-push-secret`.
4. Dans Supabase Database Webhooks, créer un webhook **INSERT uniquement**, table `public.app_records`, URL `https://<projet>.supabase.co/functions/v1/notification-push`, méthode POST, en-tête `x-push-secret` égal au secret configuré. La fonction ignore les autres collections, relit la notification et vérifie le destinataire actif et son entreprise avant l’envoi.
5. Publier le site (`npm.cmd run build`). Chaque utilisateur active les notifications depuis le bouton existant sur chacun de ses appareils. Les appareils déjà autorisés sont réinscrits à la connexion. La déconnexion invalide le jeton de cet appareil.
6. Vérifier avec deux comptes : créer une nouvelle notification pour le destinataire, vérifier le bip au premier plan, fermer l’application et vérifier une nouvelle notification système, puis ouvrir Commandes et vérifier la disparition de la pastille. Les autres onglets et comptes doivent conserver leurs propres notifications non lues.

Le service worker demande une notification non silencieuse. Le son dépend du navigateur, des autorisations système et des modes silencieux / Ne pas déranger. Il ne peut pas imposer un fichier audio lorsque l’application est fermée. Un navigateur arrêté de force ou un appareil hors ligne peut retarder la réception. Les messages expirent après 24 heures. Les anciens enregistrements ne sont pas renvoyés en masse.

Surveiller les erreurs du webhook et de la fonction : un échec FCM temporaire renvoie 502 et nécessite une nouvelle tentative du webhook ; aucune file de reprises automatiques n’est installée par ce changement. Les jetons FCM expirés sont retirés.

Références : [FCM au premier plan et en arrière-plan](https://firebase.google.com/docs/cloud-messaging/web/receive-messages), [webhooks Supabase](https://supabase.com/docs/guides/database/webhooks), [options des notifications système](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification).
