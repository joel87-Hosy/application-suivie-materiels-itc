BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Allow the account form to assign the bureau 01 emitter services while keeping
-- those codes unavailable to accounts that are not attached to bureau 01.
DO $$
DECLARE definition text; old_check text; new_check text;
BEGIN
 SELECT pg_get_functiondef('public.set_account_affiliations(uuid,uuid,text[],text[],text[],text[])'::regprocedure) INTO definition;
 old_check:=$old$x IS NULL OR x NOT IN ('B2B','DEP','MAIN')$old$;
 new_check:=$new$x IS NULL OR NOT (
   (x IN ('B2B','DEP','MAIN') AND office_codes && ARRAY['B02','BOUAKE','SAN-PEDRO','YAMOUSSOUKRO'])
   OR (x IN ('PROD','MBM','MFTTH','DR','MNM','DESS','LS','CIDATA') AND 'B01'=ANY(office_codes))
 )$new$;
 IF position(new_check IN definition)>0 THEN RETURN; END IF;
 IF position(old_check IN definition)=0 THEN RAISE EXCEPTION 'Définition de rattachement incompatible. Appliquez les migrations précédentes.'; END IF;
 definition:=replace(definition,old_check,new_check);
 EXECUTE definition;
END $$;

-- Keep the coordinator's service list aligned when they pick their emitter
-- service from the direct-command form.
DO $$
DECLARE definition text; old_change text; new_change text;
BEGIN
 SELECT pg_get_functiondef('public.choose_initial_coordinator_service(text)'::regprocedure) INTO definition;
 old_change:=$old$jsonb_build_object('serviceAbbreviation',service_code,'canChooseInitialService',false$old$;
 new_change:=$new$jsonb_build_object('serviceAbbreviation',service_code,'services',jsonb_build_array(service_code),'canChooseInitialService',false$new$;
 IF position(new_change IN definition)>0 THEN RETURN; END IF;
 IF position(old_change IN definition)=0 THEN RAISE EXCEPTION 'Définition de choix de service incompatible. Appliquez les migrations précédentes.'; END IF;
 EXECUTE replace(definition,old_change,new_change);
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
