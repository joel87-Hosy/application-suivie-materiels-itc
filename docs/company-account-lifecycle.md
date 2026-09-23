# Gestion des comptes par le directeur

Déployer dans cet ordre :

1. Appliquer `supabase/migrations/202609230003_company_account_lifecycle.sql` après les migrations précédentes.
2. Déployer l'Edge Function `company-users` : `supabase functions deploy company-users --project-ref ufstydudgffhbkkjtbbg`.
3. Publier le front généré par `npm.cmd run build`.

Si une suppression renvoie exactement « Rôle non autorisé. », ce message provient de l'ancien contrôle du rôle du compte à créer, pas du contrôle des permissions du superviseur. Vérifier le déploiement de `company-users` : publier seulement le site ne met pas à jour l'Edge Function. La version actuelle traite `delete`, `suspend`, `disable` et `activate` avant toute validation du formulaire de création. Elle autorise le rôle `Superviseur` et renvoie `{updated:true, action:...}` après confirmation par Supabase Auth et la base. Le client exige cette confirmation et signale explicitement un serveur ancien.

Le rôle Superviseur (directeur), ainsi que le rôle DG, peut suspendre, désactiver, réactiver et supprimer les comptes de son entreprise. Les comptes de direction, le super administrateur et le compte courant sont protégés ; seul le super administrateur peut agir sur un autre directeur. Le serveur vérifie les permissions et résout l'identifiant Supabase même lorsque la fiche conserve un ancien identifiant Firebase.

L'action commence par désactiver `app_profiles.is_active`. Les jetons encore valides perdent ainsi leur accès aux données via `current_app_profile()`. L'Edge Function bloque ou rétablit ensuite l'authentification avec [l'API d'administration Supabase](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid). La suppression utilise [deleteUser](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser), puis supprime les fiches utilisateurs. Les bons, mouvements et audits métier sont conservés.

Les opérations sont enregistrées dans `company_account_operations`, inaccessible aux clients. Une erreur Auth laisse le compte bloqué et l'opération en attente. Le bouton **Terminer la synchronisation Supabase** reprend l'action. Une suppression Auth réussie suivie d'une réponse perdue peut également être reprise. La réactivation ne redonne les droits applicatifs qu'après une réponse Auth réussie.

Les fonctions SQL de préparation et de finalisation sont réservées à `service_role`. La clé de service reste dans l'Edge Function et n'est jamais envoyée au navigateur.

# Commandes directes de la coordination

Coordinateur, Coordinatrice et Superviseur Terrain utilisent le même formulaire de sélection que la sortie sur bon physique : stocks dédiés, destinataire, émetteur, service, référence/motif, date, recherche et sélection des articles avec quantités. Une signature de coordination complète la commande.

Chaque stock concerné donne lieu à un bon `COORD_DIRECT_BON` au statut **EN ATTENTE VALIDATEUR**. Le serveur notifie les validateurs affectés au stock. Le validateur accepte/refuse et désigne le gestionnaire dédié. Seul ce gestionnaire peut confirmer la remise physique et débiter le stock. La saisie ne crée aucune sortie ni diminution de quantité. Les brouillons sont séparés par entreprise, compte et formulaire.

Vérifications : `tools/test_account_lifecycle.cjs`, `tools/test_account_lifecycle_endpoint.cjs` et `tools/test_direct_command.cjs`.
