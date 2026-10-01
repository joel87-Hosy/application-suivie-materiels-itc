# Notifications Supabase et pastilles

La pastille Commandes compte uniquement les notifications non lues du compte et
de cet onglet. Après rechargement, elle est recalculée depuis Supabase.

Les notifications système utilisent désormais Web Push standard, avec un
abonnement par navigateur dans `app_push_subscriptions`. Les instructions de
mise en service (clés VAPID, secrets, webhook et fonction) sont dans
[`SUPABASE_PUSH_SETUP.md`](SUPABASE_PUSH_SETUP.md). La migration
`202610060001_move_remaining_firebase_services.sql` crée la table et ses RPC.

Les anciens jetons FCM ne sont pas transférables. Chaque utilisateur doit
réactiver les notifications sur chaque appareil. Le navigateur ou le système
peut retarder les messages si l'appareil est hors ligne ou si les notifications
sont bloquées.
