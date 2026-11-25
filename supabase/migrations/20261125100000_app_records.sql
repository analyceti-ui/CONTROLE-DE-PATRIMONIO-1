CREATE TABLE IF NOT EXISTS public.app_records (
  collection text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS app_records_data_gin_idx
  ON public.app_records USING gin (data jsonb_path_ops);

ALTER TABLE public.app_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.app_records FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_records TO service_role;
