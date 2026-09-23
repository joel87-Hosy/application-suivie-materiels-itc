# Corrections et transferts des stocks dédiés

Appliquer dans l'ordre `supabase/migrations/202609230001_manager_stock_operations.sql` puis `supabase/migrations/202609230002_regional_stock_transfers.sql` à la base Supabase avant de publier le front. Les quantités existantes restent inchangées. La seconde migration retire les droits de modification des trois villes aux profils Bureau 02 qui les possédaient et synchronise leurs fiches utilisateurs, avec audit. Le déploiement statique inclut automatiquement `assets/manager-stock.js`.

Le chargement Supabase ne lance plus d'actualisation périodique. Les lectures ont lieu à la connexion, après les opérations et sur demande explicite dans les onglets concernés. Les notifications distantes ne sont donc plus actualisées par un minuteur.

Le bouton de modification d'un article utilise désormais `manager_stock_operation`. Le gestionnaire peut modifier le nom et la quantité (zéro compris) de ses stocks dédiés. Un motif est obligatoire. La fonction compare l'état affiché à l'état serveur et refuse une correction devenue obsolète. Elle conserve les valeurs avant/après et notifie les superviseurs de l'entreprise.

L'onglet **Transferts de matériel** permet de sélectionner une source, une destination, un article et une quantité, puis de renseigner le service, le motif et la signature. Chaque transfert crée un bon de sortie PDF téléchargeable depuis l'historique. Pour plusieurs articles, effectuer un transfert par article.

Le serveur vérifie le rôle actif, l'entreprise, l'affectation au stock source et le droit d'alimenter le destinataire. Dans une transaction, il débite la source, crédite ou crée l'article destinataire, enregistre les deux mouvements, le bon de sortie, l'audit et les notifications. Le même identifiant d'opération ne débite jamais deux fois. Les entrées de transfert alimentent les flux existants ; les sorties y sont reprises depuis les bons.

Le gestionnaire affecté à **ITC-B02** peut consulter et alimenter **ITC-BOUAKE**, **ITC-SAN-PEDRO** et **ITC-YAMOUSSOUKRO**, en plus de ses propres stocks. Ces villes ne sont pas proposées comme sources et leurs boutons de modification sont masqués pour lui. Les droits supplémentaires de transfert n'autorisent aucune correction, suppression ou sortie depuis les villes. Le gestionnaire local voit les transferts entrants dans l'historique et reçoit une notification. La modification locale reste réservée au périmètre de chaque gestionnaire.

Pour créer ou affecter un gestionnaire Bureau 02, sélectionner ses stocks propres (B02 et, si nécessaire, MOOV), sans cocher les trois villes : la consultation et l'alimentation sont automatiques. Le serveur refuse les nouvelles affectations partageant un stock entre deux gestionnaires actifs. Pour réaffecter un stock, retirer l'ancienne affectation ou désactiver l'ancien gestionnaire avant d'affecter le suivant.

Ces transferts d'alimentation ne passent pas par le circuit de validation des demandes des techniciens. Les protections de ce circuit restent actives pour les écritures directes.

Dans **Sortie sur Bon Physique**, la recherche de matériel filtre les noms et stocks sans distinction de casse ou d'accents. Elle masque les résultats sans supprimer les lignes cochées ni leurs quantités ; effacer la recherche réaffiche tout le matériel disponible des stocks sélectionnés.

Validation : `node tools/test_manager_stock.cjs`, `node tools/test_regional_transfers.cjs`, `node tools/test_sortie_material_search.cjs`, `npm.cmd test`, `npm.cmd run build`. Avec Node 22.17, utiliser `NODE_OPTIONS=--experimental-strip-types` pour les tests existants qui importent du TypeScript.
