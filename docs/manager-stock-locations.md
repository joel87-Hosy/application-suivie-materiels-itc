# Stocks créés par les gestionnaires

Appliquer `supabase/migrations/202609250001_manager_stock_locations.sql` après les migrations existantes, avant de publier le front. Le déploiement statique seul ne modifie pas la base Supabase.

Le menu **Mes stocks et sous-stocks** permet de créer un stock principal, ou un sous-stock rattaché à un stock déjà attribué au gestionnaire. Le nom est libre (100 caractères maximum). Chaque espace est enregistré dans `stock_locations`, avec son entreprise, son parent, son créateur et sa date. Son identifiant technique est généré par le serveur. La même transaction ajoute l’affectation dans `app_profiles` et dans la fiche utilisateur `app_records`. Le profil est rechargé après création : aucune reconnexion n’est nécessaire.

Dans cet espace, sélectionner un stock créé puis saisir la désignation, le type et la quantité pour ajouter des articles. Une réception complète la quantité d’un article existant de même type ; elle crée sinon sa fiche dans `app_records/stock`. L’entrée et son audit sont enregistrés dans la même transaction. Les nouvelles tentatives après une erreur réseau conservent l’identifiant de l’opération pour éviter les doublons.

Chaque stock et sous-stock possède son inventaire indépendant. Le parent ne cumule pas les quantités de ses enfants. Les répartitions historiques Production / Déploiement / Maintenance du Bureau 02 restent propres aux anciens stocks ; les nouveaux espaces ne sont pas ces compartiments historiques.

Les vérifications serveur imposent le rôle Gestionnaire actif, l’entreprise et l’affectation au stock. Un gestionnaire ne peut pas créer de sous-stock chez un autre gestionnaire. La modification et la suppression d’articles utilisent les opérations existantes ; les nouveaux espaces sont également disponibles comme stocks attribués dans les transferts.

Validation : `node tools/test_manager_locations.cjs`, `npm.cmd test`, `npm.cmd run build`.
