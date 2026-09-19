# Documentation antérieure à la migration Supabase

Ces pages décrivent l'architecture **Firebase** de l'application. Elles sont
conservées pour l'historique et parce que le projet Firebase `itc-erp` reste
partiellement en service, mais **leurs procédures ne sont plus celles à suivre**.

Référence à jour : [../architecture.md](../architecture.md).

Les anciens index et guides métier (`0_LIRE_DABORD.md`, `DOCUMENTATION_INDEX.md`,
`RESUME_RAPIDE.md`, `STRUCTURE_DONNEES_COMPLETE.md`, `FLUX_MATERIELS_COMPLET.md`,
`GUIDE_DEBUGGING.md`, `CODE_SNIPPETS.md`) sont également archivés ici. Leurs
exemples Firebase et leur circuit sans validateur ne doivent pas servir de
référence pour modifier l'application actuelle.

| Page | Toujours valable ? |
| --- | --- |
| `SECURITE_FIREBASE.md` | Uniquement pour la Realtime Database encore utilisée (`stock_control/`, `tenant_branding/`, `push_subscriptions/`). La sécurité des données métier est désormais dans PostgreSQL : RLS, triggers et fonctions `SECURITY DEFINER`. |
| `COMPTE_CONTROLEUR.md` | Décrit les chemins `auth_profiles/$uid/…` de la Realtime Database. Les profils vivent maintenant dans `app_profiles`. |
| `DEPENDENCY_SECURITY.md` | Concerne l'outillage Firebase. `npm audit` tourne désormais en intégration continue. |
| `PUSH_NOTIFICATIONS_SETUP.md` | La chaîne décrite est inerte : le déclencheur écoute la Realtime Database alors que les notifications sont écrites dans Supabase. À réimplémenter. |
| `DEPLOIEMENT_RENDER.md` | Périmé : indique un répertoire de publication `.` sans commande de build, alors que `render.yaml` publie `public/` après `node scripts/build_static.js`. |
