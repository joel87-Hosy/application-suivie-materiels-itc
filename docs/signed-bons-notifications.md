# Historique des bons et notifications

Appliquer `supabase/migrations/202609230004_notification_read_receipts.sql` avant de publier le site construit avec `npm run build`.
Le client utilise la fonction `mark_app_notifications_read` : elle ne marque que les clés affichées, pour le destinataire connecté et son entreprise. Une lecture répétée ne crée pas de conflit. Un déclencheur empêche les anciens clients de remettre une notification lue à l'état non lu.

L'historique regroupe demandes signées et sorties, conserve la chaîne des signatures, inclut les commandes directes, les bons physiques et les transferts, et évite de répéter une demande liée à sa sortie. Les filtres d'entreprise et de stocks restent appliqués. L'ouverture de l'onglet recharge les données sans actualisation périodique de la page.

Vérification après publication : ouvrir un onglet avec des notifications non lues, vérifier la disparition de sa pastille, recharger et vérifier qu'elle reste absente. Créer ensuite une nouvelle notification : seule celle-ci doit être comptée. Vérifier aussi un bon signé par plusieurs intervenants dans l'historique, puis son PDF.
