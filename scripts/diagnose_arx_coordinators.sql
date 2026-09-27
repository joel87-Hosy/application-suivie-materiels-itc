-- Read-only: explain why the named coordinators are eligible or excluded.
WITH wanted(email) AS (VALUES ('arx-group@itc.ci'),
 ('kablanjonas@ivoiretechnocom.ci'),('keanange@ivoiretechnocom.ci')),
 arx AS (SELECT p.company_id FROM public.app_profiles p JOIN auth.users a ON a.id=p.user_id
 WHERE lower(trim(a.email))='arx-group@itc.ci')
SELECT w.email,p.company_id,p.role,p.is_active,p.profile->>'id' AS application_id,
 public.account_offices(p.profile,p.control_scopes) AS bureaux,
 public.account_services(p.profile) AS services,
 CASE WHEN a.id IS NULL THEN 'Compte Auth absent'
 WHEN p.user_id IS NULL THEN 'Profil applicatif absent'
 WHEN w.email='arx-group@itc.ci' THEN 'Compte technicien cible'
 WHEN NOT EXISTS(SELECT 1 FROM arx WHERE company_id=p.company_id) THEN 'Entreprise différente de celle du profil ARX'
 WHEN p.role NOT IN ('Coordinateur','Coordinatrice') THEN 'Rôle incompatible : '||p.role
 WHEN NOT p.is_active THEN 'Compte inactif'
 WHEN nullif(p.profile->>'id','') IS NULL THEN 'Identifiant applicatif absent'
 WHEN NOT (public.account_offices(p.profile,p.control_scopes) ? 'B02') THEN 'Bureau 02 absent'
 WHEN NOT (public.account_services(p.profile) ? 'B2B') THEN 'Service B2B absent'
 ELSE 'Coordinateur éligible B02 / B2B' END AS diagnostic
FROM wanted w LEFT JOIN auth.users a ON lower(trim(a.email))=w.email
LEFT JOIN public.app_profiles p ON p.user_id=a.id ORDER BY w.email;
