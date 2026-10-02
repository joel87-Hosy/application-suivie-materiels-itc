DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'app_records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_records;
  END IF;
END;
$$;
