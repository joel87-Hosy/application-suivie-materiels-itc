-- Executed by PostgreSQL's official entrypoint after database initialization.
CREATE ROLE gestion_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT authenticated TO gestion_api;
\getenv api_password API_DB_PASSWORD
\getenv database_name POSTGRES_DB
GRANT CONNECT ON DATABASE :"database_name" TO gestion_api;
GRANT USAGE ON SCHEMA public, auth TO gestion_api;
GRANT SELECT ON auth.users TO gestion_api;
ALTER ROLE gestion_api PASSWORD :'api_password';
