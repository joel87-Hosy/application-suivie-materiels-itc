-- Supabase backend for cable offcuts. The Edge Function is the only writer.
CREATE TABLE IF NOT EXISTS public.cable_offcut_stores (
  company_id text NOT NULL,
  op text NOT NULL,
  state jsonb NOT NULL DEFAULT '{"lots":{},"returns":{},"requests":{},"events":{}}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, op)
);

ALTER TABLE public.cable_offcut_stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cable_offcuts_read ON public.cable_offcut_stores;
CREATE POLICY cable_offcuts_read ON public.cable_offcut_stores
  FOR SELECT TO authenticated
  USING (public.is_app_admin() OR company_id = (public.current_app_profile()).company_id);

GRANT SELECT ON public.cable_offcut_stores TO authenticated;

DO $$
DECLARE
  latest_snapshot_id text;
BEGIN
  SELECT id INTO latest_snapshot_id
  FROM migration_private.firebase_snapshots
  ORDER BY imported_at DESC
  LIMIT 1;
  IF latest_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'Aucun snapshot Firebase disponible';
  END IF;

  INSERT INTO public.cable_offcut_stores (company_id, op, state)
  SELECT
    split_part(source_path, '/', 2),
    split_part(source_path, '/', 3),
    payload
  FROM migration_private.firebase_documents
  WHERE snapshot_id = latest_snapshot_id
    AND source_path LIKE 'cable_offcuts/%/%'
  ON CONFLICT (company_id, op) DO UPDATE SET
    state = EXCLUDED.state,
    updated_at = now();
END $$;
