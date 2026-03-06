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
