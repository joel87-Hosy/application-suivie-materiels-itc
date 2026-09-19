# Architecture de l'application

État au 19 septembre 2026. Ce document décrit ce qui tourne réellement.
Les fichiers `.md` à la racine du dépôt datent d'avant la migration vers
Supabase : voir la section « Documentation antérieure » en fin de page.

## En une phrase

Application web monopage (PWA) de gestion de matériels télécom, multi-entreprises,
servie en statique et adossée à **Supabase** (PostgreSQL, Auth, Edge Functions).
Quelques fonctions tournent encore sur Firebase ; elles sont listées plus bas.

## Base de données — Supabase

Projet `gestion-materiel` (`ufstydudgffhbkkjtbbg`).

| Table | Rôle |
| --- | --- |
| `app_profiles` | Un profil par compte : rôle, entreprise, périmètre de stocks (`control_scopes`) |
| `app_records` | Toutes les données métier, une ligne par document : `(collection, record_key)` |
| `app_settings` | Réglages par entreprise |
| `cable_offcut_stores` | État des stocks de chutes de câbles, un document JSON par stock |
| `stock_workflow_config` | Activation du circuit de validation, par entreprise |

`app_records.payload` conserve la forme des documents Firebase d'origine, ce qui a
permis de migrer sans réécrire le front. Les collections sont `stock`, `sorties`,
`demandes`, `retours`, `stockMovements`, `users`, `notifications`,
`platformAuditLogs`, `companies`.

## Modèle de sécurité

Trois couches, toutes côté serveur.

**1. RLS par entreprise.** `app_records`, `app_settings` et `app_profiles` sont
cloisonnés sur `company_id`, comparé au profil de l'appelant
(`current_app_profile()`). Un `SUPER_ADMIN` traverse le cloisonnement.

**2. Trigger `guard_stock_workflow`** sur `app_records`. Il impose :

- les rôles `Validateur` / `Validatrice` sont en lecture seule partout sauf sur leurs notifications — **en toutes circonstances** ;
- les règles suivantes **uniquement si `stock_workflow_config.enabled` est vrai** pour l'entreprise : pas de suppression dans `stock` / `sorties` / `demandes`, pas d'écriture directe d'une sortie, pas de débit direct du stock, la décision du validateur n'est modifiable que par lui, et un bon prêt à livrer repasse automatiquement en `EN ATTENTE VALIDATEUR`.

Une entreprise sans ligne dans `stock_workflow_config` fonctionne donc en mode
historique, sans ces garde-fous. C'est voulu — le circuit de validation change le
processus métier — mais cela signifie que **la RLS seule autorise alors tout
utilisateur authentifié à écrire n'importe quelle donnée de son entreprise**.
Activer une nouvelle entreprise suppose de poser sa ligne de configuration.

**3. Fonctions `SECURITY DEFINER`.** Les opérations sensibles ne passent jamais
par une écriture client :

| Fonction | Rôle autorisé | Effet |
| --- | --- | --- |
| `decide_stock_request` | Validateur du bureau concerné | Approuve ou refuse un bon, désigne le gestionnaire, trace la décision |
| `issue_validated_request` | Gestionnaire affecté | Débite le stock, crée la sortie et la traçabilité, en une transaction |
| `assign_bon_service` | Gestionnaire / Superviseur | Renseigne le service émetteur sur un bon et son bon lié |
| `save_app_changes` | Tout compte | Écriture par lot avec comparaison de l'état précédent (anti-écrasement) |
| `save_offcut_state` | `service_role` uniquement | Écriture conditionnelle de l'état des chutes |
| `update_own_profile` | Tout compte | Modification de ses seules données personnelles |
| `workflow_managers` | Tout compte | Liste des gestionnaires de l'entreprise et leurs périmètres |

`issue_validated_request` verrouille les lignes de stock dans un ordre stable :
deux sorties concurrentes ne peuvent pas surtirer le même article.

## Circuit des bons de sortie

Technicien → coordination → **validateur** → gestionnaire dédié → remise physique.
Le validateur ne décide que sur les stocks de son bureau. Voir
[validator-workflow.md](validator-workflow.md) pour le détail et les bureaux.

## Front

`index.html` est un monolithe de ~14 500 lignes (dont ~13 000 de JavaScript en
ligne). Les parties extraites vivent dans `assets/` :

| Module | Rôle |
| --- | --- |
| `supabase-store.js` | Chargement du profil, lecture et écriture des données |
| `control-core.js` | Helpers purs de périmètre de stocks (opérateurs, clés de portée) |
| `validator-workflow.js` | Onglet de validation des bons |
| `cable-offcuts.js` + `-transport.js` | Stocks de chutes, via l'Edge Function |
| `stock-control.js` | Contrôle des stocks — **encore sur Firebase** |
| `assistant-*.js`, `voice-assistant.js` | Assistant et rapports |
| `bon-reference.js`, `profile.js`, `push-notifications.js` | Références de bons, profil, notifications |

Les bibliothèques tierces sont chargées depuis des CDN, **toutes épinglées** :
une mise à jour amont ne peut pas atteindre la production sans modification de
`index.html`.

## Ce qui tourne encore sur Firebase

À migrer. Le projet Firebase `itc-erp` reste donc nécessaire aujourd'hui.

| Fonction | Où | Stockage |
| --- | --- | --- |
| Contrôle des stocks (inventaires, anomalies, audits, pièces jointes) | `assets/stock-control.js` | Realtime Database `stock_control/` |
| Identité visuelle des entreprises | `index.html` | Realtime Database `tenant_branding/` |
| Création de comptes | `index.html`, `createAuthUserWithoutChangingSession` | Firebase Auth |
| Réinitialisation de mot de passe | `index.html` | Firebase Auth |
| Notifications push | `assets/push-notifications.js`, `functions/index.js` | FCM + Realtime Database `push_subscriptions/` |

**Les notifications push ne partent plus.** Le déclencheur `sendNotificationPush`
écoute `/itc_data/notifications` dans la Realtime Database, or les notifications
sont désormais écrites dans `app_records`. Le code est intact mais inerte ; il
faudra le réimplémenter côté Supabase.

`database.rules.json` reste la configuration de sécurité de la Realtime Database
et doit être maintenue tant que les fonctions ci-dessus y écrivent.

## Tests

```bash
npm test          # 19 tests : logique métier, PostgreSQL sur PGlite, service worker
```

`tools/run_tests.cjs` découvre automatiquement `tools/test_*.js`. Les tests exclus
portent chacun leur raison (navigateur Chrome, émulateur Firebase, ou fichier
local non versionné). Ils se lancent à la main :

```bash
npm run test:chutes:browser
npm run test:control:browser
npm run test:security
node tools/test_bon_reference_integration.js
TAB_AUDIT_FIXTURE=<instantané privé> node tools/test_all_tabs_browser.cjs
```

L'intégration continue (`.github/workflows/tests.yml`) exécute `npm test`,
`npm run build` et `npm audit` sur chaque push et chaque pull request.

## Déploiement

**Application web.** `npm run build` copie les fichiers publics dans `public/`,
en réécrivant la clé publique Supabase depuis `SUPABASE_PUBLISHABLE_KEY` si elle
est définie. Le build refuse toute clé secrète ou `service_role`. Render publie
`public/` en site statique (`render.yaml`).

**Base de données.** Les migrations de `supabase/migrations/` sont appliquées à
la main dans l'éditeur SQL Supabase, dans l'ordre des noms de fichiers. La table
d'historique `supabase_migrations` du projet distant est vide : `supabase db push`
rejouerait tout et ne doit pas être utilisé sans `supabase migration repair`
préalable. Vérifier l'état distant avant toute migration. Les migrations récentes
du circuit de validation sont transactionnelles et réexécutables ; les scripts
d'affectation sauvegardent les profils concernés dans `migration_private`.

**Edge Function.** `supabase/functions/cable-offcuts` se déploie séparément.

## Documentation antérieure

Une partie de la documentation décrit encore l'architecture Firebase antérieure
à la migration vers Supabase.

Les pages dont les **procédures** sont périmées ont été déplacées dans
[legacy-firebase/](legacy-firebase/) : sécurité Realtime Database, comptes
contrôleur, notifications push, déploiement Render, dépendances.

Celles qui restent à la racine décrivent la **logique métier et la forme des
données**, qui n'ont pas changé : la migration a conservé les payloads des
documents Firebase à l'identique dans `app_records.payload`. Elles restent donc
utiles — `STRUCTURE_DONNEES_COMPLETE.md`, `FLUX_MATERIELS_COMPLET.md`,
`GUIDE_DEBUGGING.md`, `CODE_SNIPPETS.md`, `RESUME_RAPIDE.md` — à condition de
lire « Realtime Database » comme « table `app_records` ».
