BEGIN;

CREATE OR REPLACE FUNCTION public.guard_duplicate_stock_request() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE request_key text; duplicate_found boolean; incoming_batch text; incoming_op text;
BEGIN
 IF NEW.collection<>'demandes' OR TG_OP<>'INSERT' OR
    coalesce(NEW.payload->>'status',NEW.payload->>'statut','') NOT IN
      ('EN ATTENTE COORDINATION','EN ATTENTE VALIDATEUR','EN ATTENTE GESTIONNAIRE','PRET','PREPAREE','APPROUVEE') THEN
  RETURN NEW;
 END IF;

 request_key:=concat_ws('|',NEW.company_id,
   upper(regexp_replace(trim(coalesce(NEW.payload->>'ref',NEW.payload->>'motif','')),'\s+',' ','g')),
   upper(trim(coalesce(NEW.payload->>'serviceAbbreviation',''))),
   left(coalesce(NEW.payload->>'dateBon',NEW.payload->>'date',''),10),
   upper(regexp_replace(trim(coalesce(NEW.payload->>'demandeurName',NEW.payload->>'tech',NEW.payload->>'receptionnaireNom','')),'\s+',' ','g')));
 incoming_batch:=nullif(NEW.payload->>'submissionBatchId','');
 incoming_op:=upper(regexp_replace(trim(coalesce(NEW.payload->>'op','')),'\s+',' ','g'));
 PERFORM pg_advisory_xact_lock(hashtext(request_key));

 SELECT EXISTS(SELECT 1 FROM app_records r
 WHERE r.collection='demandes' AND r.company_id=NEW.company_id
   AND coalesce(r.payload->>'status',r.payload->>'statut','') IN
     ('EN ATTENTE COORDINATION','EN ATTENTE VALIDATEUR','EN ATTENTE GESTIONNAIRE','PRET','PREPAREE','APPROUVEE')
   AND upper(regexp_replace(trim(coalesce(r.payload->>'ref',r.payload->>'motif','')),'\s+',' ','g'))=
       upper(regexp_replace(trim(coalesce(NEW.payload->>'ref',NEW.payload->>'motif','')),'\s+',' ','g'))
   AND upper(trim(coalesce(r.payload->>'serviceAbbreviation','')))=upper(trim(coalesce(NEW.payload->>'serviceAbbreviation','')))
   AND left(coalesce(r.payload->>'dateBon',r.payload->>'date',''),10)=left(coalesce(NEW.payload->>'dateBon',NEW.payload->>'date',''),10)
   AND upper(regexp_replace(trim(coalesce(r.payload->>'demandeurName',r.payload->>'tech',r.payload->>'receptionnaireNom','')),'\s+',' ','g'))=
       upper(regexp_replace(trim(coalesce(NEW.payload->>'demandeurName',NEW.payload->>'tech',NEW.payload->>'receptionnaireNom','')),'\s+',' ','g'))
   AND (incoming_batch IS DISTINCT FROM nullif(r.payload->>'submissionBatchId','')
        OR incoming_op IS NOT DISTINCT FROM upper(regexp_replace(trim(coalesce(r.payload->>'op','')),'\s+',' ','g'))))
 INTO duplicate_found;
 IF duplicate_found THEN
   RAISE EXCEPTION 'Cette demande (même référence, destinataire, service et date) est déjà en cours de traitement. Actualisez les bons avant de la renvoyer.';
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS aa_guard_duplicate_stock_request ON public.app_records;
CREATE TRIGGER aa_guard_duplicate_stock_request
BEFORE INSERT ON public.app_records
FOR EACH ROW EXECUTE FUNCTION public.guard_duplicate_stock_request();

REVOKE ALL ON FUNCTION public.guard_duplicate_stock_request() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
