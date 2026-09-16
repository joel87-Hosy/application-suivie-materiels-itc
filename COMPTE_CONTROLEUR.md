# Compte Contrôleur

## Accès

Dans **Superviseur → Utilisateurs entreprise**, sélectionner le rôle **Contrôleur**, puis renseigner l’identité et l’email. Le contrôleur accède automatiquement à **tous les stocks de son entreprise**, y compris les nouveaux stocks, sans affectation manuelle. Ses anciennes affectations éventuelles ne limitent plus cet accès. Le compte utilise Firebase Authentication et le changement de mot de passe existants.

Le bouton **Accès stock** reste réservé aux gestionnaires. Les contrôleurs affichent **Tous les stocks de l’entreprise** dans la liste des comptes. L’accès aux autres entreprises reste interdit.

Le contrôleur arrive dans **Contrôle des stocks**. Les gestionnaires et superviseurs disposent du même point d’entrée avec les actions correspondant à leur rôle.

## Interfaces livrées

| Interface | Fonctions |
| --- | --- |
| Tableau de bord | Synthèse multi-stocks, dernier inventaire, conformité des lignes, anomalies, échéances et activité |
| Stocks et matériels | Consultation, recherche, fiche matériel, dernier comptage daté et inventaires associés |
| Flux de stocks | Entrées, sorties, retours, bons, contrôles documentaires de transferts et régularisations |
| Missions | Création, objectif, responsable, échéance, statut, observations et pièces |
| Inventaires | Complet, tournant ou ciblé ; sélection des matériels ; gel ; comptages séparés ; rapprochement ; approbation ; clôture |
| Audits | Huit points de contrôle, preuves, résultats, réponse du gestionnaire et rapport final |
| Anomalies | Gravité, dossier source, explications, arbitrage et clôture documentée |
| Plans d’action | Responsable, échéance, réalisation déclarée par le gestionnaire, vérification par le contrôleur |
| Rapports | Dossiers conservés, synthèse CSV compatible Excel, impression et enregistrement PDF via le navigateur |
| Notifications | Journal du stock, compteur de nouveaux événements, marquage comme lu et actions échues |
| Profil | Identité et changement du mot de passe dans l’écran existant |

Les pièces jointes PNG, JPEG et PDF sont limitées à **256 Ko par fichier**. Des références et liens vers des documents plus volumineux peuvent être renseignés dans les preuves.

## Tableau de bord du contrôleur

Le contrôleur dispose d’un tableau de bord dédié. Les six indicateurs portent sur le stock sélectionné : inventaires actifs, anomalies ouvertes (dont critiques), actions à vérifier, actions en retard, audits en cours et missions actives. Les cartes ouvrent les modules correspondants.

Les priorités affichent jusqu’à dix dossiers, avec les anomalies critiques et les échéances dépassées en premier. Elles incluent les dossiers des autres contrôleurs et indiquent le créateur ; l’ouverture conserve les droits de modification existants. Les inventaires à approuver ou à régulariser sont regroupés dans « En attente du superviseur ».

La conformité compare les quantités comptées et théoriques des lignes du dernier inventaire clôturé, avant régularisation. Elle ne représente pas une certification de tout le stock actuel. Sans inventaire terminé, aucun pourcentage n’est annoncé.

La vue des stocks de l’entreprise permet de changer de stock et affiche le dernier inventaire, les anomalies ouvertes et les stocks gelés. Des raccourcis permettent de créer un inventaire, un audit, une mission ou une anomalie. L’activité récente complète cette vue ; les gestionnaires et superviseurs conservent leur tableau de bord existant.

## Inventaire contradictoire

1. Le contrôleur crée un inventaire et sélectionne les matériels.
2. Au démarrage, un verrou bloque les écritures opérationnelles du stock concerné. Les quantités de référence sont lues après acquisition du verrou.
3. Le contrôleur et le gestionnaire enregistrent leurs propres comptages. L’écran masque les quantités théoriques et le comptage de l’autre participant pendant la saisie.
4. Le gestionnaire enregistre ses observations, son accord ou son désaccord.
5. Le contrôleur soumet le dossier. Les écarts créent automatiquement des anomalies liées. Il peut demander un recomptage avant approbation.
6. Le superviseur motive sa décision : approbation ou reprise du comptage.
7. Après approbation, le superviseur applique les régularisations. Chaque ligne utilise une transaction et une marque d’application liée à l’inventaire ; une reprise ne réapplique pas les lignes déjà traitées.
8. Le dossier est clôturé puis le verrou est libéré. En cas de coupure après clôture, le bouton **Libérer le stock** termine l’opération.

Une application interrompue peut avoir régularisé seulement certaines lignes : le stock reste gelé et le superviseur reprend la même action jusqu’à clôture. La régularisation est atomique **par matériel**, pas pour toute la campagne.

Le contrôleur propriétaire ou le superviseur peut annuler un inventaire non approuvé et libérer le stock. Cela permet aussi de récupérer un inventaire dont le contrôleur a été suspendu. Un dossier approuvé doit être terminé par le superviseur.

## Audits, anomalies et actions

- Le contrôleur crée les dossiers, vérifie les critères et joint les preuves.
- Le gestionnaire du périmètre répond aux constats et fournit les preuves de réalisation.
- Le superviseur peut enregistrer un arbitrage indépendant.
- Les réponses du gestionnaire ne peuvent pas être réécrites par le contrôleur.
- La clôture nécessite une conclusion et une preuve. Une action nécessite aussi une réponse du gestionnaire ; un audit doit avoir terminé ses huit vérifications.
- Les dossiers clôturés restent consultables sans modification. Le journal d’événements accepte uniquement de nouvelles entrées.

Les responsables sont indiqués dans le dossier ; les gestionnaires autorisés sur le stock peuvent participer aux réponses et au comptage. Il ne s’agit pas d’une signature électronique certifiée.

## Flux et historique

Les nouvelles variations de quantités enregistrées par le transport Firebase produisent un journal avec matériel, quantité avant/après, variation, auteur et référence disponible. Les bons et sorties historiques restent consultables dans leur périmètre.

Le contrôle d’un transfert rapproche les justificatifs d’expédition et de réception, indique le stock destinataire et calcule l’écart. **Il ne crée pas une expédition ou une réception opérationnelle.** L’application ne possédait pas de module opérationnel de transfert à raccorder. Les anciennes entrées sans journal ne sont pas reconstruites artificiellement.

Un bon historique couvrant plusieurs opérateurs n’est pas élargi artificiellement au périmètre du contrôleur : les variations nouvelles sont consultables séparément par stock dans le journal.

## Données et sécurité

- Rôle canonique : `Contrôleur`.
- `auth_profiles/$uid/controlScopes` : stocks autorisés aux gestionnaires ; ignorés pour les contrôleurs.
- `auth_profiles/$uid/controlScopeKeys` : anciennes clés de périmètre, sans restriction pour les contrôleurs de la même entreprise.
- `itc_data/{stock,sorties,demandes,retours,stockMovements}/$key/scope_key` : index de lecture limité au stock.
- `stock_control/$company/$op` : missions, inventaires, audits, anomalies, actions, contrôles, pièces, préférences et journal.
- `stock_control/$company/$op/lock` : inventaire qui gèle le stock.
- `itc_data/stock/$key/controlAdjustments/$inventoryId` : régularisations déjà appliquées.

Les droits sont appliqués dans les règles Firebase, en plus des contrôles d’interface. Le contrôleur ne peut pas sauvegarder les collections opérationnelles via le transport général. Les quantités sont modifiées uniquement par les rôles opérationnels existants ou le superviseur lors d’une régularisation approuvée.

## Activation sur le site

Les changements locaux doivent être publiés avec les règles et l’indexation des données existantes.

1. Générer les règles : `npm run build:rules`.
2. Construire les fichiers publics : `npm run build`.
3. Publier le contenu de `public/` avec le circuit d’hébergement habituel.
4. Exécuter le script de déploiement existant avec **`--migrate`**, `--appUrl` et le chemin du compte de service. Exemple avec des valeurs à remplacer :

   ```powershell
   npm run deploy-database-rules -- --migrate --appUrl "https://VOTRE-SITE/" --serviceAccount "CHEMIN-COMPTE-SERVICE.json"
   ```

Le script vérifie les fichiers publiés, sauvegarde les données et les règles, suspend les écritures durant la migration, prépare les index et les périmètres, puis publie les règles. Coordonner cette courte période de maintenance : la nouvelle interface attend la nouvelle collection de journal et les règles correspondantes.

La migration conserve les rôles et les statuts existants et est idempotente. Le marqueur `stock_control_schema_version = 1` confirme la préparation. Le déploiement refuse de publier ces règles sans ce marqueur. Les scripts contenant les accès administratifs et les sauvegardes ne sont pas publiés dans `public/`.

## Vérification

Un émulateur Realtime Database local doit écouter sur `127.0.0.1:9000` pour les tests Firebase et navigateur :

```text
node tools/check_scripts.js
npm run test:profile
node tools/test_database_security.js
npm run test:control
npm run test:control:browser
npm run build
```

Le test navigateur utilise Chrome en mode headless et les seules données de démonstration de l’émulateur. Définir `CHROME_PATH` si Chrome n’est pas au chemin Windows habituel. Les profils de navigateur et captures de test sont dans `.tools/`, exclus de la publication.

Les tests couvrent l’isolation entreprise/stock, les modifications interdites, le gel, les comptages indépendants, l’approbation, l’absence de double régularisation, la conservation du journal, le parcours complet à trois rôles, les onglets et l’affichage mobile.
