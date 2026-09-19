-- Assign the issuing service (B2B / DEP / MAIN) to a bon and its linked counterpart.
-- Replaces a client-side Realtime Database write that no longer reached the application data.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.assign_bon_service(bon_collection text, bon_key text, service_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; target public.app_records; linked public.app_records; changes jsonb; updated jsonb := '[]'::jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.user_id IS NULL THEN RAISE EXCEPTION 'Connexion requise.'; END IF;
 IF actor.role NOT IN ('Superviseur','Gestionnaire') THEN RAISE EXCEPTION 'Service émetteur réservé au gestionnaire ou au superviseur.'; END IF;
 IF bon_collection IS NULL OR bon_collection NOT IN ('demandes','sorties') THEN RAISE EXCEPTION 'Type de bon invalide.'; END IF;
 IF service_code IS NULL OR service_code NOT IN ('B2B','DEP','MAIN') THEN RAISE EXCEPTION 'Choisissez un service autorisé : B2B, DEP ou MAIN.'; END IF;
 SELECT * INTO target FROM app_records r
  WHERE r.collection=bon_collection AND r.record_key=bon_key AND r.company_id=actor.company_id;
 IF target.record_key IS NULL THEN RAISE EXCEPTION 'Bon introuvable ou hors de votre entreprise.'; END IF;
 -- Le gestionnaire ne renseigne que les bons dont il gère tous les stocks ; le superviseur couvre l'entreprise.
 IF actor.role='Gestionnaire' AND NOT validator_covers_request(actor.control_scopes,target.payload) THEN
   RAISE EXCEPTION 'Ce bon dépend de stocks que vous ne gérez pas.';
 END IF;
 changes := jsonb_build_object('serviceAbbreviation',service_code,'serviceAssignedAt',now(),'serviceAssignedBy',actor.user_id);
 -- Le bon visé et le bon lié (demande <-> sortie) portent toujours le même service.
 FOR linked IN
   SELECT r.* FROM app_records r
    WHERE r.company_id=actor.company_id AND r.collection IN ('demandes','sorties')
      AND ( (r.collection=bon_collection AND r.record_key=bon_key)
         OR (bon_collection='demandes' AND r.collection='sorties' AND
             (r.payload->>'sourceDemandeId'=target.payload->>'id' OR r.payload->>'id'=target.payload->>'sortieId'))
         OR (bon_collection='sorties' AND r.collection='demandes' AND
             (r.payload->>'sortieId'=target.payload->>'id' OR r.payload->>'id'=target.payload->>'sourceDemandeId')) )
   ORDER BY r.collection,r.record_key FOR UPDATE
 LOOP
   IF actor.role='Gestionnaire' AND NOT validator_covers_request(actor.control_scopes,linked.payload) THEN
     RAISE EXCEPTION 'Le bon lié dépend de stocks que vous ne gérez pas.';
   END IF;
   UPDATE app_records SET payload=linked.payload||changes,updated_at=now()
     WHERE collection=linked.collection AND record_key=linked.record_key;
   updated:=updated||jsonb_build_array(jsonb_build_object('collection',linked.collection,'record_key',linked.record_key));
 END LOOP;
 RETURN updated;
END $$;
REVOKE ALL ON FUNCTION public.assign_bon_service(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assign_bon_service(text,text,text) TO authenticated;

COMMIT;
