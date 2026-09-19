# ITC Gestion Matériels

Application web de gestion de matériels télécom (stocks, bons de sortie, chutes
de câbles, contrôle et rapports), multi-entreprises, installable en PWA.

**Commencez par [docs/architecture.md](docs/architecture.md)** pour l'architecture
actuelle. L'ancienne documentation est conservée dans
[docs/legacy-firebase/](docs/legacy-firebase/) et ne décrit pas le déploiement actuel.

## Démarrer en local

L'application est statique ; il faut la servir en HTTP (pas d'ouverture en
`file://`, l'authentification ne fonctionnerait pas).

```bash
npm run build
npx http-server public -p 8080
```

La configuration Supabase publique est dans `assets/supabase-public-config.js`.
Aucune clé secrète ne doit figurer dans le dépôt.

## Tests

```bash
npm install
npm test
```

21 tests s'exécutent sans navigateur ni émulateur, dont des tests PostgreSQL
réels sur PGlite. Les tests navigateur et émulateur se lancent séparément — voir
la section « Tests » de [docs/architecture.md](docs/architecture.md).
La CI les exécute sur chaque push, quelle que soit la branche, et sur chaque pull request.

## Publier

```bash
npm run build     # produit public/
```

Render publie `public/` en site statique (`render.yaml`). Les migrations de base
de données s'appliquent à la main dans l'éditeur SQL Supabase : voir la section
« Déploiement » de [docs/architecture.md](docs/architecture.md).

## Backend IA (optionnel)

`server/ai-chat-backend.js` sert de relais vers Gemini pour éviter d'exposer la
clé dans le navigateur.

Copier `server/.env.example` vers `.env` et renseigner `GEMINI_API_KEY`, puis
exporter les variables (PowerShell) :

```powershell
$env:GEMINI_API_KEY="votre_cle"
$env:ENABLE_LOCAL_FALLBACK="true"
$env:CHAT_BACKEND_TOKEN="votre_token"
$env:ALLOWED_ORIGINS="http://localhost:8080"
```

Lancer `npm run ai-backend` — vérification sur `http://localhost:8787/health` —
puis pointer le front vers le relais depuis la console du navigateur :

```js
localStorage.setItem("itc_ai_backend_endpoint", "http://localhost:8787/api/chat");
localStorage.setItem("itc_ai_backend_token", "votre_token");
```

Sans relais joignable, le chatbot bascule sur Gemini en direct (si une clé
locale est configurée), puis sur une réponse locale.

## Firebase

Le projet Firebase `itc-erp` reste nécessaire : le contrôle des stocks, l'identité
visuelle des entreprises et la réinitialisation de mot de
passe n'ont pas encore été migrés. La liste exacte est dans
[docs/architecture.md](docs/architecture.md#ce-qui-tourne-encore-sur-firebase).
Le service historique de notifications est documenté dans
[functions/README.md](functions/README.md) ; il ne reçoit pas les notifications Supabase.
La création de comptes par le superviseur passe par l'Edge Function Supabase
`company-users` ; les affectations de stocks sont vérifiées côté serveur.

Pour les tests locaux, ajouter `localhost` et `127.0.0.1` aux domaines autorisés
dans la console Firebase (Authentication → Settings) du projet `itc-erp`.
