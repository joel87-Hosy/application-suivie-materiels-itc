# Audit des dépendances — 17 septembre 2026

Le log transmis annonçait 25 vulnérabilités. L'audit effectué sur le verrouillage
présent au début de l'intervention en signalait 49 (2 critiques, 23 élevées,
22 modérées, 2 faibles). Le catalogue des avis et les dépendances installées
peuvent expliquer cette différence ; le log seul ne permet pas de la trancher.

## Corrections

- Mise à jour des dépendances et du fichier `package-lock.json`.
- Firebase Admin 14.4.0 et adaptation des scripts aux imports modulaires
  `firebase-admin/app`, `firebase-admin/auth`, `firebase-admin/database`.
- Suppression de la dépendance directe inutilisée `node-forge`.
- Remplacement ciblé du `uuid` de gaxios 6.7.1 par 11.1.1, qui conserve
  l'export CommonJS `v4` utilisé pour les requêtes multipart. Test local effectué.
- Node.js 22 minimum ; version locale de référence 24.15.0 dans `.node-version`.

## Résultat et limites

`npm audit --omit=dev` : **0 vulnérabilité**.

L'audit complet signale encore **5 alertes modérées**, aucune élevée ou critique :
`@opentelemetry/core`, `@google-cloud/pubsub`, `csv-parse`, `stream-json` et
`firebase-tools`. Elles proviennent des dépendances du CLI Firebase 15.30.1.
Les compteurs incluent les paquets parents affectés et ne représentent pas
nécessairement cinq failles indépendantes.

Ne pas lancer `npm audit fix --force` : il propose notamment un retour du CLI
à 10.1.1. Les versions corrigées des sous-dépendances sortent des plages requises
par le CLI ; les imposer globalement sans migration peut casser ses imports
et les commandes d'import de données. Suivre les mises à jour du CLI.

Le déploiement Render configuré publie `public/`, sans `node_modules` ni scripts
d'administration. Cela limite l'exposition du site à ces dépendances Node.
Cet audit ne couvre pas toutes les bibliothèques chargées par CDN dans le navigateur
et ne constitue pas une preuve d'absence de compromission.

## Vérifications

- Construction statique, syntaxe des scripts, tests des profils.
- Tests des règles de sécurité et du contrôle de stock sur émulateur local.
- Signature de jetons avec clé de test temporaire, lectures/écritures Admin SDK
  sur émulateur et requête multipart locale : `node tools/test_admin_dependencies.js`.

Pour reproduire : utiliser Node 24, `npm ci`, puis `npm audit --omit=dev` et
`npm audit`. Les résultats peuvent évoluer avec la publication de nouveaux avis.
Les tests utilisant la base nécessitent l'émulateur sur `127.0.0.1:9000`.

Référence officielle pour la migration Admin SDK :
https://firebase.google.com/support/release-notes/admin/node
