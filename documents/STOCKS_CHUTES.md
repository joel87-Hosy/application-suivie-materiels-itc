# Stocks de chutes de câbles

Chaque stock d'origine possède un espace **Stocks de chutes**, même s'il est encore vide. Il est proposé à partir des stocks et affectations existants. Les lots sont créés à la première réception. Aucun stock normal n'est augmenté ou diminué par ce module.

## Utilisation

- **Technicien :** depuis Retour matériel, ouvrir « Retour de câble en bon état → stock de chutes ». Choisir le câble sur son bon de sortie, saisir la distance restante en mètres et le motif. La somme des retours en cours ou reçus ne peut pas dépasser la longueur délivrée. Les retours refusés libèrent cette longueur.
- **Coordinateur :** ouvrir Stocks de chutes, choisir son stock dédié et valider ou refuser le retour. La validation ne change pas encore le disponible.
- **Gestionnaire :** contrôler la longueur et l'état du câble puis confirmer la réception physique. La chute devient un lot disponible, avec le lien vers le bon d'origine. Si le métrage est incorrect, refuser avec un motif afin que le technicien corrige sa déclaration.
- **Chutes déjà présentes dans l'entrepôt :** le gestionnaire saisit le nom du câble, la longueur et l'origine. Faire une saisie par longueur continue, sans additionner plusieurs morceaux en un seul lot.
- **Réutilisation :** le technicien choisit un lot, sa longueur demandée et le chantier. Le coordinateur valide ; le gestionnaire confirme la sortie physique. Le lot est débité à ce moment. La validation ne réserve pas le lot : sa disponibilité est contrôlée à nouveau lors de la sortie.
- **Nouveau retour après réutilisation :** le bon de chute délivré figure dans la liste des câbles retournables. Le nouveau lot conserve le lien vers le précédent.

Les quantités acceptent deux décimales, en mètres. Chaque bon porte la mention **STOCK DE CHUTES**, le stock d'origine, le lot, la longueur, le technicien et les validations datées. Les rapports PDF et Excel sont disponibles dans le même module, ainsi que le journal des actions. Actualiser pour charger les opérations effectuées par un autre utilisateur.

Les gestionnaires et coordinateurs accèdent à leurs stocks affectés. Le superviseur (compte DG) et le contrôleur consultent les stocks de leur entreprise ; ils ne valident pas de mouvement de chute. Les techniciens voient les lots disponibles et leurs propres dossiers. Les retours des autres matériels et les câbles défectueux conservent leur circuit existant.

## Architecture et déploiement

Le module utilise `cable_offcuts/{company_id}/{op}` avec `lots`, `returns`, `requests`, `events` et `commands`. Les lectures et commandes passent par la fonction callable `cableOffcuts` dans la région `europe-west1`. Les écritures directes depuis le navigateur sont interdites. Les autorisations sont relues côté serveur et chaque commande modifie atomiquement l'état du stock. Un identifiant de commande protège les nouvelles tentatives contre les doubles réceptions et doubles sorties.

Les notifications sont envoyées dans le système interne existant aux coordinateurs et gestionnaires affectés et au technicien concerné. Une panne de notification ne remet pas en cause un mouvement déjà enregistré.

Déployer ensemble les composants suivants pour activer la fonction en ligne :

1. Installer les dépendances existantes de `functions/` si nécessaire.
2. Déployer la fonction : `firebase deploy --only functions:notifications:cableOffcuts --project itc-erp`.
3. Générer les règles avec `npm run build:rules`, puis déployer `database.rules.json` avec la procédure habituelle. Le nouveau chemin est fermé par défaut, y compris avec les anciennes règles.
4. Construire le site avec `npm run build` et publier le répertoire `public/` via Render. Le cache applicatif passe à `v17-cable-offcuts`.

Aucune conversion des données de stock normal n'est requise. Les anciens comptes d'équipes sans `controlScopes` utilisent leur affectation `managedOps` administrée dans leur profil. Les anciens retours de câbles en bon état ne sont pas intégrés automatiquement : ils doivent être déclarés depuis un bon source dans le nouveau circuit.

## Vérifications

- `npm run test:chutes` : étapes obligatoires, mètres décimaux, droits, suivi des lots, tentatives répétées et rapprochement journal/stock.
- `npm run test:chutes:browser` : circuit complet dans Chrome, saisie entrepôt, réutilisation, bouton du bon PDF, retour d'une chute et consultation superviseur/contrôleur.
- `npm run test:chutes:integration` : fonction réelle et base émulée, écritures atomiques, deux sorties concurrentes, notifications et refus des écritures directes.

Les tests d'intégration exigent Java 21 et ne fonctionnent qu'avec l'émulateur ; ils ne modifient pas la production.
