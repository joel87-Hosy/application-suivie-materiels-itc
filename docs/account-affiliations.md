# Bureaux et services des comptes

Les comptes technicien, coordinateur/coordinatrice, gestionnaire et validateur/validatrice disposent de `office` (B01, B02, BOUAKE, SAN-PEDRO ou YAMOUSSOUKRO) et `serviceAbbreviation` (B2B, MAIN ou DEP). Les comptes contrôleur et superviseur, y compris superviseur terrain, ne sont pas soumis à cette affectation.

- **Nouveau compte** : le responsable choisit le bureau et le service dans Administration entreprise. Les stocks dédiés restent des droits distincts. L'enregistrement Auth + profil conserve la gestion des échecs existante ; le profil et son rattachement sont enregistrés dans une même transaction SQL.
- **Compte existant** : le responsable utilise « Bureau et service » dans la liste des comptes. La modification est enregistrée dans `app_profiles`, la fiche `app_records/users` et le journal d'audit.
- **Coordinateurs existants sans service** : « Mon bureau et service » ouvre leur profil et permet de choisir B2B, Maintenance ou Déploiement une fois. Le responsable pourra corriger cette affectation ensuite. Ce choix personnel n'est pas proposé aux futurs comptes, dont le service est défini à la création. Il ne permet pas de changer soi-même de bureau.
- **Technicien** : le champ Émetteur contient exclusivement les coordinateurs actifs de son entreprise, de son bureau et de son service. Aucun coordinateur par défaut n'est inventé. Le service émetteur est celui du compte. L'absence de coordinateur compatible bloque l'envoi.
- **Validateur** : il traite tous les bons de sortie provenant de son bureau, indépendamment de son propre service et des stocks demandés. Les notifications et confirmations après expiration suivent ce même bureau. Le renouvellement reste réservé au validateur ayant approuvé le bon initialement.

Le bureau d'origine est enregistré sur chaque nouvelle demande par le serveur à partir du profil authentifié. Il ne peut pas être changé par une écriture directe. Pour les demandes anciennes, le bureau est déterminé, quand cela est possible, à partir du technicien puis du coordinateur. Une origine déjà enregistrée reste conservée lors d'un changement ultérieur d'affectation du compte. Les décisions, signatures, débits de stock et durées de validité conservent leurs protections existantes.

## Reprise des comptes existants

La migration `202609260002_account_affiliations.sql` conserve une sauvegarde privée des profils puis rattache les techniciens ITC existants (`COMP-ITC-LEGACY`) au **bureau 02 / B2B**. Elle ne modifie pas les techniciens des autres entreprises ni les techniciens créés après sa première application.

Le bureau des autres comptes concernés est repris uniquement s'il est explicite (`office` ou `validationBureau`) ou si leurs stocks indiquent un bureau unique. Une affectation ambiguë doit être renseignée par le responsable ; aucun service n'est inventé pour les autres comptes. Un coordinateur sans bureau peut choisir son service, mais reste absent des choix proposés aux techniciens jusqu'à son affectation à un bureau. Un ancien bon dont l'origine reste inconnue ne peut pas être validé avant rattachement de son compte source.

## Mise en ligne

1. Appliquer les migrations précédentes, puis `supabase/migrations/202609260002_account_affiliations.sql`.
2. Déployer la fonction Supabase `company-users` actualisée.
3. Publier le frontend et son service worker, puis actualiser les sessions.
4. Vérifier les bureaux des coordinateurs existants, puis leur faire choisir leur service. Compléter les autres comptes concernés via l'administration.

La préparation des fichiers n'applique pas automatiquement ces changements à la base distante.

Vérification locale : `node tools/test_account_affiliations.cjs`, `node tools/test_account_affiliations_browser.cjs` (Chrome installé), et la suite `npm test` avec Node configuré pour les tests TypeScript existants.
