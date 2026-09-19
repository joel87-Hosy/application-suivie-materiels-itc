# Sécurité Firebase Realtime Database

Les lectures et écritures globales de `itc_data` sont interdites. Les données métier restent aux mêmes chemins, avec un `company_id` obligatoire. Chaque lecture du navigateur utilise une requête indexée `orderByChild('company_id').equalTo(...)`. Les règles vérifient l'entreprise dans `auth_profiles`, jamais dans une valeur choisie par le navigateur.

## Droits appliqués

- Un compte doit avoir un profil de sécurité actif et appartenir à une entreprise active. Un compte Firebase seul ne donne aucun accès métier.
- Le super-administrateur actif peut administrer toutes les entreprises, mais ne peut pas remplacer ou supprimer la racine de la base depuis le navigateur.
- Un superviseur peut administrer les comptes subordonnés de son entreprise. Il ne peut pas créer un directeur, modifier son propre profil de sécurité, ni reprendre un compte d'une autre entreprise.
- Les techniciens peuvent créer leurs demandes et retours en attente. Ils ne peuvent pas modifier le stock, valider une demande ou modifier les demandes d'un collègue.
- Les rôles de gestion et de coordination conservent les opérations métier de leur entreprise. Les périmètres internes par opérateur (`managedOps`) restent des restrictions d'interface ; cette version impose la frontière entre entreprises et les droits par rôle, pas une séparation serveur entre bureaux d'une même entreprise.
- Les modifications personnelles sont limitées aux coordonnées, au nom et au statut de changement de mot de passe. Le rôle, l'entreprise et l'activation ne sont pas modifiables par le titulaire.
- Suspension ou suppression d'un profil : mise à jour atomique du profil affiché et de `auth_profiles`. Une suppression du profil révoque l'accès à la base sans supprimer l'identité Firebase Authentication.
- Les mots de passe temporaires sont affichés une seule fois lors de la création et ne sont plus enregistrés dans la base. La migration retire les anciennes valeurs, sans changer les mots de passe Firebase Auth.

`assets/secure-store.js` conserve les clés Firebase des enregistrements et ne sauvegarde que les changements. Les notifications et opérations métier sont regroupées ; l'interface attend la réponse Firebase avant de confirmer une opération. La déconnexion détache les abonnements et efface les données locales privées.

## Vérifications

```powershell
npm.cmd run build:rules
npm.cmd run test:security
npm.cmd run test:profile
node tools/check_scripts.js
npm.cmd run build
npm.cmd run migrate:security
```

L'émulateur nécessite Java 21 dans `PATH`. Il utilise uniquement le projet fictif `demo-itc-security`. `tools/test_database_security.js` vérifie les refus et autorisations avec les vraies règles et le transport de l'application. `tools/test_migrated_dataset.js`, exécuté dans l'émulateur, vérifie une copie migrée de la production ; il ne modifie pas la production.

La migration est une simulation par défaut. Elle conserve les clés et les données métier, normalise les profils historiques vers `COMP-ITC-LEGACY` et réserve `PLATFORM` aux super-administrateurs. Les enregistrements historiques sans entreprise sont rattachés à leur utilisateur lorsque son identifiant est disponible, sinon à ITC. Toute entreprise inconnue ou divergence de rôle arrête la migration. Les suspensions existantes sont conservées. Les paramètres communs deviennent `tenant_settings/{companyId}`.

## Publication coordonnée

Ne pas publier uniquement les nouvelles règles : l'ancienne application lit et réécrit toute la base. Prévoir une courte maintenance et demander aux équipes de recharger l'application après publication.

1. Publier cette version de l'application sur Render. Le répertoire public doit être **`public`**, généré par `node scripts/build_static.js`, comme indiqué dans `render.yaml`. Pour un service configuré manuellement, modifier aussi ses paramètres Render. Ne jamais servir la racine du dépôt : elle contient les outils et peut contenir des fichiers privés.
2. Exécuter la publication coordonnée :

```powershell
npm.cmd run deploy-database-rules -- --serviceAccount tools/serviceAccountKey.json --appUrl https://application-suivie-materiels-itc.onrender.com --migrate
```

Le script vérifie que les trois fichiers du client publiés correspondent à cette version, valide les données, sauvegarde les règles, suspend les écritures des clients, sauvegarde et migre les données par transaction, puis publie et relit les règles définitives. Une modification administrative concurrente interrompt la migration. Les sauvegardes sont dans `.security-backups/`, ignoré par Git et exclu du répertoire public. Elles contiennent des données privées : conserver ce dossier localement avec des accès limités.

Si la migration échoue après le gel, les écritures restent suspendues ; diagnostiquer l'erreur avant de rouvrir les accès. Ne pas restaurer automatiquement les anciennes règles permissives. Une fois le problème résolu, le même script peut être relancé : la migration est idempotente.

Pour les publications ultérieures, omettre `--migrate`. La vérification du client publié et la comparaison des règles restent obligatoires.

Source : [conditions et requêtes dans les règles Firebase](https://firebase.google.com/docs/database/security/rules-conditions).