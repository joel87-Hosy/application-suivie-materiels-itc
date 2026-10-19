# Backend autonome en environnement test

Cette composition est isolée des projets Compose `supabase` et
`supabase-gestion-test`. Elle crée son propre volume PostgreSQL et n'importe
aucune donnée automatiquement. Ne la relier à aucune base Supabase source.

Avant toute restauration, exécuter le précontrôle en lecture seule depuis le
VPS : `bash deploy/standalone/preflight-test-source.sh`. Il accepte uniquement
le conteneur portant le label Compose `supabase-gestion-test`, vérifie le dump
connu et affiche les extensions, comptes, profils et formats de hash. Il ne
restaure rien.

## Préparer le VPS

1. Copier ce dossier dans une nouvelle destination, par exemple
   `/opt/gestion-backend-test/deploy/standalone`, sans remplacer le site actif.
2. Créer `.env` à partir de `.env.example`; choisir deux mots de passe
   aléatoires distincts et une clé de session d'au moins 64 caractères.
   Utiliser le mot de passe dédié à l'API dans `API_DB_PASSWORD` et
   `DATABASE_URL`. Encoder les caractères réservés pour l'URL. Le rôle API est
   créé à la première initialisation avec `NOBYPASSRLS`.
3. Vérifier les paramètres puis démarrer uniquement avec ce fichier :

   ```sh
   docker compose --project-directory /opt/gestion-backend-test/deploy/standalone \
     --env-file /opt/gestion-backend-test/deploy/standalone/.env \
     -f /opt/gestion-backend-test/deploy/standalone/docker-compose.yml config
   docker compose --project-directory /opt/gestion-backend-test/deploy/standalone \
     --env-file /opt/gestion-backend-test/deploy/standalone/.env \
     -f /opt/gestion-backend-test/deploy/standalone/docker-compose.yml up -d --build
   ```

4. Vérifier `curl http://127.0.0.1:18788/api/health`. Le résultat attendu est
   `{"ok":true,"service":"gestion-backend","database":"connected"}`.

L'API vérifie les hashes bcrypt présents dans `auth.users` et émet un cookie de
session HttpOnly si un profil actif existe. Les routes métier renvoient encore
HTTP 501 : ce n'est pas un remplacement du site. Aucune migration, import ou
écriture sur la production n'est effectuée par ces fichiers.
