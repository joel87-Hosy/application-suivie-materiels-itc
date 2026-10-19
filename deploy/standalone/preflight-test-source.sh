#!/usr/bin/env bash
set -euo pipefail

# Read-only inventory of the dedicated Supabase TEST database and its backup.
# No Compose command is used, and production container labels are rejected.
SOURCE_CONTAINER="${SOURCE_CONTAINER:-supabase-gestion-test-db-1}"
SOURCE_DATABASE="${SOURCE_DATABASE:-postgres}"
BACKUP_FILE="${BACKUP_FILE:-/root/gestion-test-avant-migration-20261019-140014.dump}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERREUR: docker introuvable." >&2
  exit 1
fi
if ! docker inspect "$SOURCE_CONTAINER" >/dev/null 2>&1; then
  echo "ERREUR: conteneur source absent: $SOURCE_CONTAINER" >&2
  exit 1
fi
project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$SOURCE_CONTAINER")"
if [[ "$project" != "supabase-gestion-test" ]]; then
  echo "REFUS: le conteneur $SOURCE_CONTAINER appartient au projet '$project', pas au projet test attendu." >&2
  exit 1
fi
if [[ ! -s "$BACKUP_FILE" ]]; then
  echo "ERREUR: dump absent ou vide: $BACKUP_FILE" >&2
  exit 1
fi

echo "SOURCE_PROJECT=$project"
echo "SOURCE_CONTAINER=$SOURCE_CONTAINER"
echo "SOURCE_DATABASE=$SOURCE_DATABASE"
echo "BACKUP_FILE=$BACKUP_FILE"
stat -c 'BACKUP_BYTES=%s' "$BACKUP_FILE"
sha256sum "$BACKUP_FILE" | awk '{print "BACKUP_SHA256=" $1}'

echo
echo "=== Comptes et profils (lecture seule) ==="
docker exec "$SOURCE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$SOURCE_DATABASE" <<'SQL'
SELECT 'totals' AS section,
  (SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')) AS non_system_tables,
  (SELECT count(*) FROM pg_tables WHERE schemaname='public') AS public_tables,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prokind IN ('f','p')) AS public_functions,
  (SELECT count(*) FROM auth.users) AS auth_users,
  (SELECT count(*) FROM public.app_profiles) AS app_profiles,
  (SELECT count(*) FROM public.app_profiles WHERE is_active) AS active_profiles;

SELECT 'profile_identity_match' AS section,
  count(*) FILTER (WHERE u.id IS NOT NULL) AS profile_with_auth,
  count(*) FILTER (WHERE u.id IS NULL) AS profile_without_auth
FROM public.app_profiles p LEFT JOIN auth.users u ON u.id=p.user_id;

SELECT 'auth_without_profile' AS section, count(*) AS auth_users_without_profile
FROM auth.users u LEFT JOIN public.app_profiles p ON p.user_id=u.id
WHERE p.user_id IS NULL;

SELECT 'duplicate_active_emails' AS section, count(*) AS duplicated_email_groups
FROM (
  SELECT lower(email) FROM auth.users
  WHERE deleted_at IS NULL AND email IS NOT NULL
  GROUP BY lower(email) HAVING count(*) > 1
) duplicates;

SELECT 'profiles_by_role' AS section, role, count(*)
FROM public.app_profiles GROUP BY role ORDER BY role;

SELECT 'auth_hash_format' AS section,
  CASE WHEN encrypted_password LIKE '$2%' THEN 'bcrypt'
       WHEN encrypted_password LIKE '$argon2%' THEN 'argon2'
       WHEN encrypted_password IS NULL OR encrypted_password='' THEN 'missing'
       ELSE 'other' END AS format,
  count(*)
FROM auth.users GROUP BY 2 ORDER BY 2;

SELECT 'extensions' AS section, extname, extversion
FROM pg_extension ORDER BY extname;
SQL

echo
echo "=== Contrôle du dump sans restauration ==="
docker run --rm --network none -v "$BACKUP_FILE:/source.dump:ro" postgres:17.6 \
  pg_restore --list /source.dump > /tmp/gestion-test-dump-toc.txt
echo "TOC_ENTRIES=$(wc -l < /tmp/gestion-test-dump-toc.txt | tr -d ' ')"
echo "PUBLIC_SCHEMA_ENTRIES=$(grep -Ec ' (TABLE|TABLE DATA|FUNCTION|PROCEDURE|TRIGGER|INDEX|CONSTRAINT) public ' /tmp/gestion-test-dump-toc.txt || true)"
echo "AUTH_SCHEMA_ENTRIES=$(grep -Ec ' auth ' /tmp/gestion-test-dump-toc.txt || true)"
echo "EXTENSION_ENTRIES=$(grep -Ec ' EXTENSION ' /tmp/gestion-test-dump-toc.txt || true)"
echo "Aucune donnée n'a été modifiée ni restaurée."
