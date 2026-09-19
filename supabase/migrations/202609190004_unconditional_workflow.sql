-- Enforce the stock workflow even without a company configuration row.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.stock_workflow_config ALTER COLUMN enabled SET DEFAULT true;
CREATE OR REPLACE FUNCTION public.guard_stock_workflow() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE actor public.app_profiles; previous jsonb;
BEGIN
 IF current_user NOT IN ('authenticated','anon') THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.role IN ('Validateur','Validatrice') AND coalesce(NEW.collection,OLD.collection)<>'notifications' THEN
   RAISE EXCEPTION 'Utilisez la validation des bons. Ce rôle consulte les autres données en lecture seule.';
 END IF;
 IF TG_OP='DELETE' AND OLD.collection IN ('stock','sorties','demandes') THEN RAISE EXCEPTION 'Suppression interdite : traçabilité des bons.'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.collection='sorties' AND (TG_OP='INSERT' OR NEW.payload IS DISTINCT FROM OLD.payload) THEN
   RAISE EXCEPTION 'La sortie physique doit passer par un bon validé.';
 END IF;
 IF NEW.collection='stock' AND TG_OP='UPDATE' AND (NEW.payload->>'qty')::numeric < (OLD.payload->>'qty')::numeric THEN
   RAISE EXCEPTION 'Le débit du stock nécessite un bon validé et une sortie physique.';
 END IF;
 IF NEW.collection='demandes' THEN
   previous := CASE WHEN TG_OP='UPDATE' THEN OLD.payload ELSE '{}'::jsonb END;
   IF (NEW.payload->'validatorDecision') IS DISTINCT FROM (previous->'validatorDecision') THEN
     RAISE EXCEPTION 'La décision appartient au validateur.';
   END IF;
   IF previous ? 'validatorDecision' AND NEW.payload IS DISTINCT FROM previous THEN
     RAISE EXCEPTION 'Bon déjà traité. Actualisez la liste avant toute opération.';
   END IF;
   IF coalesce(NEW.payload->>'status','') IN ('LIVREE','PRET','PREPAREE','APPROUVEE','EN ATTENTE GESTIONNAIRE')
      AND coalesce(previous->>'status','') NOT IN ('LIVREE') THEN
     NEW.payload := NEW.payload || jsonb_build_object('status','EN ATTENTE VALIDATEUR','statut','EN ATTENTE VALIDATEUR');
   END IF;
 END IF;
 RETURN NEW;
END $$;

COMMIT;
