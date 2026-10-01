# Architecture de l'application

Ã‰tat au 19 septembre 2026. Ce document dÃ©crit ce qui tourne rÃ©ellement.
Les anciennes pages de documentation sont archivÃ©es dans
`docs/legacy-firebase/` : voir la section Â« Documentation antÃ©rieure Â» en fin de page.

## En une phrase

Application web monopage (PWA) de gestion de matÃ©riels tÃ©lÃ©com, multi-entreprises,
servie en statique et adossÃ©e Ã  **Supabase** (PostgreSQL, Auth, Edge Functions).
Tous les services d?ex?cution de l?application utilisent Supabase.

## Base de donnÃ©es â€” Supabase

Projet `gestion-materiel` (`ufstydudgffhbkkjtbbg`).

| Table | RÃ´le |
| --- | --- |
| `app_profiles` | Un profil par compte : rÃ´le, entreprise, pÃ©rimÃ¨tre de stocks (`control_scopes`) |
| `app_records` | Toutes les donnÃ©es mÃ©tier, une ligne par document : `(collection, record_key)` |
| `app_settings` | RÃ©glages par entreprise |
| `cable_offcut_stores` | Ã‰tat des stocks de chutes de cÃ¢bles, un document JSON par stock |
| `stock_workflow_config` | Configuration historique ; ne dÃ©sactive plus les protections du circuit |
| `stock_locations` | Registre des stocks dÃ©diÃ©s, y compris les stocks sans matÃ©riel |

`app_records.payload` conserve la forme des documents Firebase d'origine, ce qui a
permis de migrer sans rÃ©Ã©crire le front. Les collections sont `stock`, `sorties`,
`demandes`, `retours`, `stockMovements`, `users`, `notifications`,
`platformAuditLogs`, `companies`.

## ModÃ¨le de sÃ©curitÃ©

Trois couches, toutes cÃ´tÃ© serveur.

**1. RLS par entreprise.** `app_records`, `app_settings` et `app_profiles` sont
cloisonnÃ©s sur `company_id`, comparÃ© au profil de l'appelant
(`current_app_profile()`). Un `SUPER_ADMIN` traverse le cloisonnement.

**2. Trigger `guard_stock_workflow`** sur `app_records`. Il impose :

- les rÃ´les `Validateur` / `Validatrice` sont en lecture seule partout sauf sur leurs notifications â€” **en toutes circonstances** ;
- pour toute entreprise : pas de suppression dans `stock` / `sorties` / `demandes`, pas d'Ã©criture directe d'une sortie, pas de dÃ©bit direct du stock, dÃ©cision par la fonction de validation et passage d'un nouveau bon prÃªt Ã  livrer en `EN ATTENTE VALIDATEUR`.

Ces protections ne dÃ©pendent plus de `stock_workflow_config.enabled` : elles
s'appliquent mÃªme si la ligne est absente ou vaut `false`. La migration
`202609190004_unconditional_workflow.sql` modifie le garde-fou et le dÃ©faut de
configuration, sans modifier les quantitÃ©s, les bons ou les historiques.
Le navigateur et le service de chutes imposent Ã©galement le circuit validateur.
Les fonctions serveur autorisÃ©es conservent leur accÃ¨s transactionnel aux donnÃ©es.

**3. Fonctions `SECURITY DEFINER`.** Les opÃ©rations sensibles ne passent jamais
par une Ã©criture client :

| Fonction | RÃ´le autorisÃ© | Effet |
| --- | --- | --- |
| `decide_stock_request` | Validateur du bureau concernÃ© | Approuve ou refuse un bon, dÃ©signe le gestionnaire, trace la dÃ©cision |
| `issue_validated_request` | Gestionnaire affectÃ© | DÃ©bite le stock, crÃ©e la sortie et la traÃ§abilitÃ©, en une transaction |
| `assign_bon_service` | Gestionnaire / Superviseur | Renseigne le service Ã©metteur sur un bon et son bon liÃ© |
| `save_app_changes` | Tout compte | Ã‰criture par lot avec comparaison de l'Ã©tat prÃ©cÃ©dent (anti-Ã©crasement) |
| `save_offcut_state` | `service_role` uniquement | Ã‰criture conditionnelle de l'Ã©tat des chutes |
| `update_own_profile` | Tout compte | Modification de ses seules donnÃ©es personnelles |
| `workflow_managers` | Tout compte | Liste des gestionnaires de l'entreprise et leurs pÃ©rimÃ¨tres |

`issue_validated_request` verrouille les lignes de stock dans un ordre stable :
deux sorties concurrentes ne peuvent pas surtirer le mÃªme article.

## Circuit des bons de sortie

Technicien â†’ coordination â†’ **validateur** â†’ gestionnaire dÃ©diÃ© â†’ remise physique.
Le validateur ne dÃ©cide que sur les stocks de son bureau. Voir
[validator-workflow.md](validator-workflow.md) pour le dÃ©tail et les bureaux.

## Front

`index.html` est un monolithe de ~14 500 lignes (dont ~13 000 de JavaScript en
ligne). Les parties extraites vivent dans `assets/` :

| Module | RÃ´le |
| --- | --- |
| `supabase-store.js` | Chargement du profil, lecture et Ã©criture des donnÃ©es |
| `control-core.js` | Helpers purs de pÃ©rimÃ¨tre de stocks (opÃ©rateurs, clÃ©s de portÃ©e) |
| `validator-workflow.js` | Onglet de validation des bons |
| `cable-offcuts.js` + `-transport.js` | Stocks de chutes, via l'Edge Function |
| `stock-control.js` + `stock-control-store.js` | Contr?le des stocks via Supabase |
| `assistant-*.js`, `voice-assistant.js` | Assistant et rapports |
| `bon-reference.js`, `profile.js`, `push-notifications.js` | RÃ©fÃ©rences de bons, profil, notifications |

Les bibliothÃ¨ques tierces sont chargÃ©es depuis des CDN, **toutes Ã©pinglÃ©es** :
une mise Ã  jour amont ne peut pas atteindre la production sans modification de
`index.html`.

## Services actifs

Les services d'exécution utilisent Supabase : Auth, PostgreSQL, Edge Functions,
contrôle d'inventaire, identité visuelle, réinitialisation de mot de passe et
notifications Web Push. Le service worker ne charge plus de SDK Firebase.

La migration `202610060001_move_remaining_firebase_services.sql` ajoute les
états d'inventaire tenant-scoped, leurs RPC transactionnelles et les abonnements
Web Push. Voir [SUPABASE_PUSH_SETUP.md](SUPABASE_PUSH_SETUP.md) pour les clés
VAPID et le webhook de notifications.

Les scripts de migration et les tests historiques Firebase sont conservés dans
le dépôt afin de pouvoir relire ou importer les anciennes données ; ils ne font
pas partie du site en production.
## Tests

```bash
npm test          # 21 tests : logique mÃ©tier, PostgreSQL sur PGlite, service worker
```

`tools/run_tests.cjs` dÃ©couvre automatiquement `tools/test_*.js`. Les tests exclus
portent chacun leur raison (navigateur Chrome, Ã©mulateur Firebase, ou fichier
local non versionnÃ©). Ils se lancent Ã  la main :

```bash
npm run test:chutes:browser
npm run test:control:browser
npm run test:security
node tools/test_bon_reference_integration.js
TAB_AUDIT_FIXTURE=<instantanÃ© privÃ©> node tools/test_all_tabs_browser.cjs
```

L'intÃ©gration continue (`.github/workflows/tests.yml`) exÃ©cute `npm test`,
`npm run build` et `npm audit` sur chaque push de toute branche et chaque pull request.

## DÃ©ploiement

**Application web.** `npm run build` copie les fichiers publics dans `public/`,
en rÃ©Ã©crivant la clÃ© publique Supabase depuis `SUPABASE_PUBLISHABLE_KEY` si elle
est dÃ©finie. Le build refuse toute clÃ© secrÃ¨te ou `service_role`. Render publie
`public/` en site statique (`render.yaml`).

**Base de donnÃ©es.** Les migrations de `supabase/migrations/` sont appliquÃ©es Ã 
la main dans l'Ã©diteur SQL Supabase, dans l'ordre des noms de fichiers. La table
d'historique `supabase_migrations` du projet distant est vide : `supabase db push`
rejouerait tout et ne doit pas Ãªtre utilisÃ© sans `supabase migration repair`
prÃ©alable. VÃ©rifier l'Ã©tat distant avant toute migration. Les migrations rÃ©centes
du circuit de validation sont transactionnelles et rÃ©exÃ©cutables ; les scripts
d'affectation sauvegardent les profils concernÃ©s dans `migration_private`.

**Edge Function.** `supabase/functions/cable-offcuts` se dÃ©ploie sÃ©parÃ©ment.
`supabase/functions/company-users` crÃ©e les comptes Supabase Ã  la demande d'un
superviseur autorisÃ©. La crÃ©ation du profil et de sa fiche utilisateur est
transactionnelle. Les stocks sÃ©lectionnÃ©s sont inscrits dans `managedOps`,
`control_scopes` et `control_scope_keys` ; les identifiants ne sont pas envoyÃ©s par email.

Les stocks `ITC-BOUAKE`, `ITC-SAN-PEDRO` et `ITC-YAMOUSSOUKRO` sont crÃ©Ã©s vides,
avec leurs stocks de chutes. Leurs bons suivent le circuit existant et sont
validÃ©s par les deux validateurs du bureau 02. Aucun gestionnaire n'est affectÃ©
automatiquement : le superviseur choisit les stocks Ã  la crÃ©ation du compte ou
via Â« AccÃ¨s stock Â». Une sÃ©lection explicite ne reÃ§oit aucun stock supplÃ©mentaire
en fonction du nom du compte ou du bureau. Les Ã©critures directes de matÃ©riel
sont Ã©galement contrÃ´lÃ©es par `guard_dedicated_stock`.

## Documentation antÃ©rieure

Une partie de la documentation dÃ©crit encore l'architecture Firebase antÃ©rieure
Ã  la migration vers Supabase.

Les pages dont les **procÃ©dures** sont pÃ©rimÃ©es ont Ã©tÃ© dÃ©placÃ©es dans
[legacy-firebase/](legacy-firebase/) : sÃ©curitÃ© Realtime Database, comptes
contrÃ´leur, notifications push, dÃ©ploiement Render, dÃ©pendances.

Les anciens guides mÃ©tier, exemples de code et index ont Ã©galement Ã©tÃ© archivÃ©s.
Ils peuvent dÃ©crire un circuit sans validateur ou des Ã©critures Firebase qui ne
sont plus valides. Pour le circuit actuel, utiliser [validator-workflow.md](validator-workflow.md).
Le service push Supabase est configur? selon [SUPABASE_PUSH_SETUP.md](SUPABASE_PUSH_SETUP.md).
