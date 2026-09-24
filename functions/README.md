# Ancien service de notifications Firebase

Ce dossier ne sert plus les opérations métier Supabase. Les fonctions de stocks
de chutes ont été supprimées ; leur remplaçant est
[`supabase/functions/cable-offcuts`](../supabase/functions/cable-offcuts/).

`index.js` conserve uniquement `sendNotificationPush`, qui écoute les créations
dans `/itc_data/notifications` de Firebase Realtime Database. Les notifications
de l'application actuelle sont écrites dans `public.app_records` sur Supabase :
ce déclencheur ne les reçoit pas. Il n'existe pas de relais Supabase vers ce
service. Ne pas le déployer pour résoudre un problème de notification Supabase.

Le nouveau relais Supabase est préparé dans `supabase/functions/notification-push`.
Sa mise en service (secrets, webhook, abonnements) est décrite dans
[`docs/notification-push.md`](../docs/notification-push.md). Il doit être déployé
séparément du site ; le build statique ne l’active pas.

Le dossier reste présent pour identifier et maintenir l'ancien déploiement.
Le supprimer du dépôt ne supprimerait pas les fonctions déjà déployées.

Les SDK Firebase du navigateur ont encore des usages distincts et actifs :
inventaires et contrôles, identité visuelle et récupération
de mot de passe. Leur retrait nécessite la migration de ces parcours et des
données correspondantes. La liste à jour est dans
[`docs/architecture.md`](../docs/architecture.md#ce-qui-tourne-encore-sur-firebase).
