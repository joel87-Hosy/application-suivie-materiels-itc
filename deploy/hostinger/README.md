# Déploiement Hostinger

Cette configuration est destinée au VPS qui a déjà Nginx Hostinger sur 80/443.
Le vhost applicatif écoute uniquement `127.0.0.1:8082`; le reverse proxy TLS
global Hostinger doit le joindre après qu'on a vérifié et ajouté le nom d'hôte.

Construire depuis la racine du dépôt avec `SUPABASE_URL` et
`SUPABASE_PUBLISHABLE_KEY` définis. Publier le contenu de `public/` dans une
nouvelle version, puis basculer le lien `current` atomiquement. Ne jamais
publier une clé `sb_secret_` ou `service_role`.

La clé publique auto-hébergée ne pourra être mise ici qu'après installation du
stack Supabase; l'URL prévue est `https://www.gestion-materiels.suitepilot.io`.
Garder temporairement l'ancienne application et le projet Supabase distant
actifs pendant l'import et la validation.
