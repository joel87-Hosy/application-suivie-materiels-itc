# Validation des bons de sortie

Les rôles `Validateur` et `Validatrice` consultent les stocks, flux et rapports de
l’entreprise. Ils approuvent ou refusent les demandes de sortie. La gestion des
comptes reste réservée au superviseur / administrateur.

Circuit : demande du technicien → coordination → validateur → gestionnaire dédié
→ remise physique. Une demande directe du coordinateur ou du gestionnaire passe
aussi par le validateur. Un seul des validateurs traite chaque bon ; une seconde
décision est refusée. Le motif est obligatoire pour refuser.

Le validateur choisit un gestionnaire actif qui couvre tous les stocks du bon.
Les demandes portant sur plusieurs périmètres sans gestionnaire commun doivent
être séparées par gestionnaire. L’approbation ne réserve ni ne débite les quantités.
Le gestionnaire confirme la remise physique ; le serveur contrôle le stock et
enregistre le débit, le bon et sa traçabilité dans une transaction. Réessayer une
sortie déjà effectuée ne débite pas à nouveau.

Les bons de chutes suivent également cette validation. Le circuit des retours
de câbles reste technicien → coordinateur → réception physique du gestionnaire.
Le service de chutes utilise une écriture conditionnelle pour éviter d’écraser
une décision ou une sortie concurrente.

## Déploiement

1. Appliquer `supabase/migrations/202609180005_validator_workflow.sql`. Cette
   migration est transactionnelle et réexécutable ; elle n’active pas le circuit.
2. Déployer `supabase/functions/cable-offcuts` et les fichiers web/PWA.
3. Créer / affecter les profils Supabase de validation et vérifier leur connexion.
4. Sauvegarder les bons et les états de chutes concernés. Activer uniquement
   l’entreprise concernée dans `stock_workflow_config` et faire passer ses bons
   non sortis à `EN ATTENTE VALIDATEUR` (ou `VALIDATOR_PENDING` pour les chutes).
   Préserver les bons livrés, les quantités et les historiques.
5. Reconnecter les sessions ouvertes pour charger le nouveau circuit.

La base bloque les écritures de sortie provenant d’un ancien client. Le
déploiement de l’interface doit donc précéder l’activation. Les identifiants
initiaux restent dans un fichier local ignoré par Git ; ne jamais les publier.

## Vérification locale

```text
node tools/test_validator_workflow.cjs
node tools/test_validator_offcuts.cjs
node tools/test_cable_offcuts_browser.js
node tools/test_profile.js
node tools/test_supabase_pagination.js
npm.cmd run build
```

Les tests PostgreSQL utilisent PGlite, fourni dans les dépendances de l’outillage
Firebase. Le test de navigateur utilise Chrome en mode headless et un service
local de test ; il n’écrit pas dans la production.
