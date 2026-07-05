
-- Path layout: <company_id>/<...anything>
-- The first path segment is the company id; membership decides access.

DO $$
DECLARE b TEXT;
BEGIN
  FOR b IN SELECT unnest(ARRAY['proof-of-completion','incident-photos','documents','maintenance-invoices'])
  LOOP
    EXECUTE format($f$
      CREATE POLICY %I ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = %L AND public.is_company_member(((storage.foldername(name))[1])::uuid));
    $f$, b || '_select', b);

    EXECUTE format($f$
      CREATE POLICY %I ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = %L AND public.is_company_member(((storage.foldername(name))[1])::uuid));
    $f$, b || '_insert', b);

    EXECUTE format($f$
      CREATE POLICY %I ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = %L AND public.is_company_member(((storage.foldername(name))[1])::uuid));
    $f$, b || '_update', b);

    EXECUTE format($f$
      CREATE POLICY %I ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = %L AND public.is_company_member(((storage.foldername(name))[1])::uuid));
    $f$, b || '_delete', b);
  END LOOP;
END $$;
