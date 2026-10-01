# Configuration Web Push avec Supabase

Les notifications système utilisent le Web Push standard. Firebase Messaging
n'est plus chargé par l'application.

1. Générez une paire VAPID, par exemple avec `npx web-push generate-vapid-keys`.
   Gardez la clé privée secrète et ne la commitez jamais.
2. Placez la clé publique dans `assets/push-config.js` (`vapidPublicKey`).
3. Configurez les secrets du projet Supabase :

   ```sh
   supabase secrets set VAPID_PUBLIC_KEY="<clé publique>" VAPID_PRIVATE_KEY="<clé privée>" VAPID_SUBJECT="mailto:<adresse de support>" PUSH_WEBHOOK_SECRET="<secret webhook>"
   ```

4. Déployez la fonction `notification-push` et configurez le webhook Postgres
   pour appeler `/functions/v1/notification-push` à l'insertion d'un
   enregistrement `notifications` dans `app_records`. Envoyez le secret dans
   l'en-tête `x-push-secret`.
5. Appliquez la migration `202610060001_move_remaining_firebase_services.sql`.
   Chaque utilisateur doit ensuite réactiver les notifications dans son profil.

Les abonnements FCM historiques ne peuvent pas être convertis en abonnements
Web Push. Chaque navigateur doit s'inscrire une fois avec la nouvelle clé.
