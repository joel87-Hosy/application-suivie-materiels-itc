# Corrections et transferts des stocks dédiés

Appliquer `supabase/migrations/202609230001_manager_stock_operations.sql` à la base Supabase avant de publier le front. Cette migration ajoute une fonction ; elle ne modifie pas les stocks existants. Le déploiement statique inclut automatiquement `assets/manager-stock.js`.

Le chargement Supabase ne lance plus d'actualisation périodique. Les lectures ont lieu à la connexion, après les opérations et sur demande explicite dans les onglets concernés. Les notifications distantes ne sont donc plus actualisées par un minuteur.

Le bouton de modification d'un article utilise désormais `manager_stock_operation`. Le gestionnaire peut modifier le nom et la quantité (zéro compris) de ses stocks dédiés. Un motif est obligatoire. La fonction compare l'état affiché à l'état serveur et refuse une correction devenue obsolète. Elle conserve les valeurs avant/après et notifie les superviseurs de l'entreprise.

L'onglet **Transferts entre mes stocks** permet de sélectionner une source, une destination, un article et une quantité, puis de renseigner le service, le motif et la signature. Chaque transfert crée un bon de sortie PDF téléchargeable depuis l'historique. Pour plusieurs articles, effectuer un transfert par article.

Le serveur vérifie le rôle actif, l'entreprise et l'affectation aux deux stocks. Dans une transaction, il débite la source, crédite ou crée l'article destinataire, enregistre les deux mouvements, le bon de sortie, l'audit et les notifications. Le même identifiant d'opération ne débite jamais deux fois. Les entrées de transfert alimentent les flux existants ; les sorties y sont reprises depuis les bons.

Ces transferts internes entre les stocks du même gestionnaire ne passent pas par le circuit de validation des demandes des techniciens. Les protections de ce circuit restent actives pour les écritures directes.

Validation : `node tools/test_manager_stock.cjs`, `npm.cmd test`, `npm.cmd run build`.
