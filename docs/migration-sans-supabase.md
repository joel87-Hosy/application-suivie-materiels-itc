# Migration vers un backend indépendant de Supabase

## Objectif et protection de la production

L'application doit fonctionner sur l'infrastructure Hostinger sans Supabase
(Auth, API REST/RPC, Realtime, Edge Functions ou Studio). PostgreSQL peut rester
le moteur de base de données, mais il sera administré directement par le
backend de l'application.

La production reste en service pendant la préparation. Aucun conteneur ni
volume Supabase de production ne doit être arrêté ou supprimé avant la bascule
finale et sa période de retour arrière.

## État constaté

- Le site actif est servi par Nginx depuis
  `/var/www/gestion-materiels/current`.
- La configuration du site actif pointe sur
  `https://www.gestion-materiels.suitepilot.io`, l'API de l'instance auto-
  hébergée sur le VPS.
- Deux projets Compose distincts sont présents : `supabase` (production) et
  `supabase-gestion-test` (test). Les commandes Compose lancées depuis le
  mauvais fichier/dossier ont déjà sélectionné la production; identifier les
  conteneurs par leurs labels avant toute opération.
- Une archive logique de la base de test a été créée dans
  `/root/gestion-test-avant-migration-20261019-140014.dump` (28 Mo). Vérifier
  qu'elle existe encore avant de l'utiliser.
- La base de test contient au moins 268 demandes, 496 sorties, 435 articles de
  stock et 44 profils. Elle contient donc des données à préserver; ne pas la
  traiter comme une base jetable.
- L'inventaire PostgreSQL test (résultat reçu, à confirmer car la capture est
  tronquée) indique 77 tables applicatives/non-système, 114 fonctions publiques
  et 450 comptes `auth.users`. L'écart entre 450 identités Auth et 44 profils
  applicatifs doit être réconcilié avant de migrer les connexions.
- Le frontend dépend de Supabase pour le chargement/écriture des documents,
  l'authentification, les RPC, les tables de lecture directe, les événements
  temps réel et trois Edge Functions (`cable-offcuts`, `company-users`,
  `notification-push`). Le dépôt contient 79 migrations SQL et 105 noms de
  fonctions SQL distincts.
- `npm run inventory:backend` parcourt 30 fichiers frontend et 79 migrations.
  Il trouve 40 noms RPC aux points d'appel (dont deux passés par des liaisons
  dynamiques), cinq tables accédées directement, sept méthodes Auth nommées et
  deux URLs d'Edge Functions explicites. La troisième fonction, `notification-
  push`, est appelée par webhook Postgres plutôt que par le navigateur.
- L'inventaire du frontend montre des accès Auth pour connexion, déconnexion,
  session, changement/réinitialisation du mot de passe et écoute de session;
  des accès de données directs à `app_records`, `app_profiles`, `app_settings`,
  `stock_locations` et `stock_control_states`; et 40 noms RPC appelés.
  Exemples d'opérations sensibles à reprendre : `save_app_changes`,
  `decide_stock_request_signed`, `issue_stock_request_signed`,
  `manager_stock_operation`, `dispense_stock_bon_signed_v2`, les retours,
  corrections, affiliations, comptes d'entreprise et sous-stocks.
- Un prototype d'API métier isolée a été ajouté dans `server/backend-api.js`.
  Il n'expose aucun exécuteur RPC/SQL générique : la connexion est encore
  explicitement désactivée (HTTP 501) et les routes métier restent fermées.
  Le Compose d'essai dans `deploy/standalone/` crée son propre PostgreSQL,
  volume nommé et port API localhost `18788`; il n'importe aucune donnée et
  ne partage pas les volumes Supabase. Cette cible n'est pas encore déployée
  sur le VPS.
- Le code actuel de création/suspension des comptes et des chutes utilise les
  Edge Functions; Web Push est également raccordé à une fonction et à un
  webhook de base. Ces flux ont besoin d'équivalents explicites dans le backend
  cible.
- Les migrations métier utilisent principalement `auth.uid()` et lisent aussi
  `auth.users`. Cela rend plausible une transition où l'API Node authentifie les
  sessions puis injecte l'identité dans les transactions PostgreSQL, afin de
  réutiliser les règles et fonctions métier. Il reste à vérifier les usages
  dynamiques, les rôles SQL, extensions et dépendances d'initialisation avant
  de choisir cette voie.
- Le backend HTTP métier autonome est en cours de préparation dans
  `server/backend-api.js`: login bcrypt/cookie HttpOnly et validation du profil
  avec l'identité SQL transactionnelle; les routes métier restent fermées (501).
- `deploy/standalone/` contient un Compose autonome, une compatibilité minimale
  `auth.users`/`auth.uid()`, `pgcrypto` et un rôle `gestion_api` sans
  `BYPASSRLS`. Ces fichiers ont été validés localement avec Docker Compose et
  valeurs fictives, mais aucun conteneur n'a encore été démarré sur le VPS.
- `deploy/standalone/preflight-test-source.sh` est un précontrôle lecture seule
  destiné au VPS : il vérifie l'étiquette Compose du conteneur source (refuse
  toute autre instance), les comptes/profils/hashes, les extensions et la table
  des matières du dump. Aucun import ne démarre avant d'avoir lu son résultat.

## Architecture cible

```text
Navigateur/PWA
    │ HTTPS même origine
    ▼
Nginx Hostinger ── fichiers statiques versionnés
    │ /api/*
    ▼
API métier Node (port local, non exposé publiquement)
    │ rôle DB privé; transactions et contrôle de chaque action
    ▼
PostgreSQL administré directement par l'application
```

Les identifiants PostgreSQL privilégiés restent uniquement sur le serveur.
Le navigateur ne reçoit ni accès SQL ni clé admin. L'API applique les droits,
le cloisonnement entreprise et les règles métier avant chaque écriture.

## Parcours de migration sans interruption

1. **Inventaire et sauvegardes** : relever les tables, profils, comptes Auth,
   fonctions/RPC utilisées, extensions, volumes et notifications. Vérifier
   l'archive de test et produire un export `pg_dump` séparé de production avant
   toute migration de données.
2. **Cible isolée** : créer un nouveau projet Compose `gestion-backend-test`
   contenant PostgreSQL autonome et l'API Node, avec volume et port liés à
   `127.0.0.1`. Il ne partage ni conteneur ni volume avec les deux projets
   Supabase existants.
3. **Données de test** : importer une copie de test, sans écriture vers la
   source. Migrer les comptes avec leurs hashes de mot de passe si leur format
   est compatible; sinon prévoir une réinitialisation des mots de passe. Ne
   jamais copier la clé `service_role` ou le `.env` Supabase.
4. **API métier** : remplacer progressivement les accès directs PostgREST/RPC
   par des endpoints Node validés côté serveur. Couvrir l'authentification,
   les sessions, profils, données, opérations atomiques de stock et demandes,
   comptes, chutes, contrôles, notifications, fichiers et fonctions IA.
5. **Frontend test** : une copie du site pointe sur le backend de test. Tester
   les parcours de chaque rôle, la concurrence, les droits multi-entreprises,
   les exports, les signatures, la PWA et les notifications. Production reste
   inchangée pendant toute cette phase.
6. **Répétition et bascule** : répéter export/import, comparer les nombres de
   lignes et les soldes de stock, planifier une courte fenêtre de lecture seule,
   importer les dernières écritures, puis basculer Nginx et le lien de release.
   Garder l'ancienne production démarrable et son dump vérifié pour retour
   arrière.
7. **Retrait de Supabase** : seulement après validation réelle, période
   d'observation et vérification qu'aucune requête ne contacte l'API Supabase,
   retirer les services et volumes Supabase selon un plan de conservation des
   sauvegardes.

## État d'avancement

Préparation effectuée : inventaire automatisé du code, séparation des projets
Compose confirmée, production identifiée, archive de test réalisée, et cible
autonome de test définie localement. La configuration Compose se valide avec
des valeurs factices et confirme une base/volume distincts et une publication
API sur `127.0.0.1`. Aucun backend autonome n'est encore installé sur le VPS;
aucune migration de données/comptes ni bascule frontend n'a été faite. Les
nombres exacts, extensions et différence Auth/profils de la base test restent à
confirmer avant l'import du dump. Les fichiers de migration ne permettent pas
encore de servir les parcours métier de l'application.

Régénérer l'inventaire du dépôt avec `npm run inventory:backend`.
