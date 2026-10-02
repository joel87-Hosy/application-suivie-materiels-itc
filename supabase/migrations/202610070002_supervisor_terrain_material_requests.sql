BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Some installations still have the earlier role allowlists installed.
-- Extend them in place so the field supervisor can receive an affiliation,
-- including when a supervisor account is created through the multi-affiliation RPC.
DO $$
DECLARE definition text; old_check text; new_check text;
BEGIN
  SELECT pg_get_functiondef('public.set_account_affiliations(uuid,uuid,text[],text[],text[],text[])'::regprocedure)
    INTO definition;
  old_check := $old$target.role NOT IN ('Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice')$old$;
  new_check := $new$target.role NOT IN ('Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice','Superviseur Terrain')$new$;
  IF position(new_check IN definition)=0 THEN
    IF position(old_check IN definition)=0 THEN
      RAISE EXCEPTION 'Définition de rattachement incompatible. Vérifiez les migrations des rattachements.';
    END IF;
    EXECUTE replace(definition,old_check,new_check);
  END IF;

  SELECT pg_get_functiondef('public.register_company_user_multi(uuid,uuid,text,text,text,text,text[],text[],text[],text[],text[])'::regprocedure)
    INTO definition;
  old_check := $old$user_role IN ('Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice')$old$;
  new_check := $new$user_role IN ('Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice','Superviseur Terrain')$new$;
  IF position(new_check IN definition)=0 THEN
    IF position(old_check IN definition)=0 THEN
      RAISE EXCEPTION 'Définition de création de compte incompatible. Vérifiez les migrations des rattachements.';
    END IF;
    EXECUTE replace(definition,old_check,new_check);
  END IF;
END $$;

-- Accept the field supervisor's submitted office and service and record the
-- field supervisor as the coordinator of the direct material request.
DO $$
DECLARE definition text; old_check text; new_check text;
BEGIN
  SELECT pg_get_functiondef('public.guard_account_affiliation()'::regprocedure) INTO definition;
  old_check := $old$IF TG_OP='INSERT' AND actor.role IN ('Technicien','Coordinateur','Coordinatrice') THEN$old$;
  new_check := $new$IF TG_OP='INSERT' AND actor.role IN ('Technicien','Coordinateur','Coordinatrice','Superviseur Terrain') THEN$new$;
  IF position(new_check IN definition)=0 THEN
    IF position(old_check IN definition)=0 THEN
      RAISE EXCEPTION 'Définition de validation des demandes incompatible. Vérifiez les migrations des rattachements.';
    END IF;
    EXECUTE replace(definition,old_check,new_check);
  END IF;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
