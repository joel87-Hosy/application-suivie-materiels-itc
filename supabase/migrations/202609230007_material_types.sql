BEGIN;
CREATE OR REPLACE FUNCTION public.add_material_type(type_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; result jsonb; label text := upper(trim(type_name));
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS NULL OR actor.role NOT IN ('Gestionnaire','Superviseur','DG','SUPER_ADMIN') THEN RAISE EXCEPTION 'Ajout réservé au gestionnaire ou superviseur actif.'; END IF;
 IF label IS NULL OR label='' OR length(label)>150 OR label='__ADD_NEW__' THEN RAISE EXCEPTION 'Type de matériel invalide.'; END IF;
 INSERT INTO app_settings(company_id,setting_key,value) VALUES(actor.company_id,'materialTypes','[]') ON CONFLICT DO NOTHING;
 SELECT value INTO result FROM app_settings WHERE company_id=actor.company_id AND setting_key='materialTypes' FOR UPDATE;
 SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO result FROM (
   SELECT DISTINCT upper(trim(value)) AS value FROM jsonb_array_elements_text(coalesce(result,'[]'::jsonb)||jsonb_build_array(label))
   WHERE trim(value)<>''
 ) types;
 UPDATE app_settings SET value=result,updated_at=now() WHERE company_id=actor.company_id AND setting_key='materialTypes';
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.add_material_type(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_material_type(text) TO authenticated;
COMMIT;
