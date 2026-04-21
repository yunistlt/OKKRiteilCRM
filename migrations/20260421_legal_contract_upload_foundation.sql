INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'legal-contracts',
    'legal-contracts',
    false,
    26214400,
    ARRAY[
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
    ]
)
ON CONFLICT (id) DO UPDATE
SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.legal_contract_reviews
    ADD COLUMN IF NOT EXISTS title text,
    ADD COLUMN IF NOT EXISTS file_name text,
    ADD COLUMN IF NOT EXISTS storage_bucket text DEFAULT 'legal-contracts',
    ADD COLUMN IF NOT EXISTS storage_path text,
    ADD COLUMN IF NOT EXISTS content_type text,
    ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
    ADD COLUMN IF NOT EXISTS upload_status text DEFAULT 'pending_upload',
    ADD COLUMN IF NOT EXISTS scan_status text DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS analysis_status text DEFAULT 'queued',
    ADD COLUMN IF NOT EXISTS analysis_error text,
    ADD COLUMN IF NOT EXISTS extracted_text text,
    ADD COLUMN IF NOT EXISTS latest_version integer DEFAULT 1,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_legal_contract_reviews_storage_path ON public.legal_contract_reviews(storage_path);
CREATE INDEX IF NOT EXISTS idx_legal_contract_reviews_order_status ON public.legal_contract_reviews(order_id, upload_status, analysis_status);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'legal_contracts_select'
    ) THEN
        CREATE POLICY legal_contracts_select
        ON storage.objects
        FOR SELECT
        USING (
            bucket_id = 'legal-contracts'
            AND (
                auth.role() = 'service_role'
                OR public.has_full_order_access()
                OR public.can_access_order(split_part(name, '/', 1)::bigint)
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'legal_contracts_insert'
    ) THEN
        CREATE POLICY legal_contracts_insert
        ON storage.objects
        FOR INSERT
        WITH CHECK (
            bucket_id = 'legal-contracts'
            AND (
                auth.role() = 'service_role'
                OR public.has_full_order_access()
                OR public.can_access_order(split_part(name, '/', 1)::bigint)
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'legal_contracts_update'
    ) THEN
        CREATE POLICY legal_contracts_update
        ON storage.objects
        FOR UPDATE
        USING (
            bucket_id = 'legal-contracts'
            AND auth.role() = 'service_role'
        )
        WITH CHECK (
            bucket_id = 'legal-contracts'
            AND auth.role() = 'service_role'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'legal_contracts_delete'
    ) THEN
        CREATE POLICY legal_contracts_delete
        ON storage.objects
        FOR DELETE
        USING (
            bucket_id = 'legal-contracts'
            AND auth.role() = 'service_role'
        );
    END IF;
END $$;