# Deploiement Render HTTPS

## Type de service

Creer un service Render de type `Static Site`.

## Reglages

- Repository: ce projet GitHub/GitLab
- Branch: branche principale du projet
- Build command: laisser vide
- Publish directory: `.`
- Auto deploy: selon votre preference

Le fichier `render.yaml` contient deja ces reglages pour un Blueprint Render.

## Firebase

Pour conserver les donnees existantes, garder la meme configuration Firebase dans `index.html`.

Apres le premier deploiement Render, ajouter le domaine Render dans Firebase:

1. Ouvrir Firebase Console.
2. Aller dans Authentication.
3. Ouvrir Settings.
4. Ouvrir Authorized domains.
5. Ajouter le domaine Render, par exemple `votre-app.onrender.com`.

## PWA

La PWA devient installable quand:

- le site est servi en HTTPS;
- `manifest.webmanifest` est accessible;
- `sw.js` est accessible a la racine;
- les icones sont valides;
- le navigateur juge l'app installable.

## Donnees

Le deploiement Render ne vide pas Firebase. Les donnees importantes restent dans `itc_data`.

Faire tout de meme une sauvegarde Firebase avant le premier deploiement public.
