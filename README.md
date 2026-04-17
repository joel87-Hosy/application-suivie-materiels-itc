Notes de développement — Firebase OAuth domains

Contexte

- Le navigateur empêche les opérations OAuth (popup/redirect) si le domaine courant n'est pas listé dans la section "Authorized domains" de Firebase (Authentication → Settings).

Aide rapide

- Pour les tests locaux, ouvrez la console Firebase et ajoutez ces domaines :
  - localhost
  - 127.0.0.1

Où aller dans la console Firebase

- URL : https://console.firebase.google.com/project/<PROJECT_ID>/authentication/settings
- Remplacez <PROJECT_ID> par `itc-erp` (projectId présent dans `index.html`).

Serveur local recommandé (ne pas ouvrir via file://)

- Node (http-server) :

```bash
npx http-server . -p 8080
```

- Python 3 :

```bash
python -m http.server 8080
```

Notes avancées

- Il n'est pas possible d'ajouter un domaine autorisé directement depuis le client web sans privilèges serveur (il faudrait utiliser l'API Admin de Firebase avec des identifiants de service). Si vous voulez un script automatisé, je peux fournir un script Node.js qui utilise des credentials de compte de service pour modifier les settings du projet (à exécuter depuis une machine de confiance).

Mini backend IA securise (Gemini)

- Un endpoint backend est disponible dans `server/ai-chat-backend.js`.
- Il permet de proteger la cle Gemini et d'appeler le modele depuis le serveur.

Demarrage

1. Copier `server/.env.example` vers un fichier `.env` local et renseigner au minimum `GEMINI_API_KEY`.
2. Exporter les variables dans votre terminal (PowerShell):

```powershell
$env:GEMINI_API_KEY="votre_cle"
$env:ENABLE_LOCAL_FALLBACK="true"
$env:CHAT_BACKEND_TOKEN="votre_token"
$env:ALLOWED_ORIGINS="http://localhost:8080"
```

3. Lancer le backend:

```bash
npm run ai-backend
```

4. Configurer le frontend (console navigateur) pour utiliser le backend:

```js
localStorage.setItem("itc_ai_backend_endpoint", "http://localhost:8787/api/chat");
localStorage.setItem("itc_ai_backend_token", "votre_token");
```

Verification rapide

- Health check backend: `http://localhost:8787/health`
- Si le backend est indisponible, le chatbot bascule automatiquement vers Gemini direct (si cle locale) puis vers la reponse locale.
- Si Gemini n'est pas configure ou echoue, le backend peut repondre en mode local de secours (`source: local-fallback`) quand `ENABLE_LOCAL_FALLBACK=true`.
