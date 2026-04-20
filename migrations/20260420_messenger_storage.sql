-- Messenger attachments bucket and storage access policies

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'chat-attachments',
    'chat-attachments',
    false,
    15728640,
    ARRAY[
        'application/msword',
        'application/pdf',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/gif',
        'image/jpeg',
        'image/png',
        'image/webp',
        'text/csv',
        'text/plain'
    ]
)
ON CONFLICT (id) DO UPDATE
SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'messenger_attachments_select'
    ) THEN
        CREATE POLICY messenger_attachments_select
        ON storage.objects
        FOR SELECT
        USING (
            bucket_id = 'chat-attachments'
            AND (
                auth.role() = 'service_role'
                OR EXISTS (
                    SELECT 1
                    FROM public.chat_participants cp
                    WHERE cp.chat_id::text = split_part(name, '/', 1)
                      AND cp.user_id = (auth.jwt() ->> 'retail_crm_manager_id')::bigint
                )
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'messenger_attachments_insert'
    ) THEN
        CREATE POLICY messenger_attachments_insert
        ON storage.objects
        FOR INSERT
        WITH CHECK (
            bucket_id = 'chat-attachments'
            AND (
                auth.role() = 'service_role'
                OR EXISTS (
                    SELECT 1
                    FROM public.chat_participants cp
                    WHERE cp.chat_id::text = split_part(name, '/', 1)
                      AND cp.user_id = (auth.jwt() ->> 'retail_crm_manager_id')::bigint
                )
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'messenger_attachments_update'
    ) THEN
        CREATE POLICY messenger_attachments_update
        ON storage.objects
        FOR UPDATE
        USING (
            bucket_id = 'chat-attachments'
            AND auth.role() = 'service_role'
        )
        WITH CHECK (
            bucket_id = 'chat-attachments'
            AND auth.role() = 'service_role'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'messenger_attachments_delete'
    ) THEN
        CREATE POLICY messenger_attachments_delete
        ON storage.objects
        FOR DELETE
        USING (
            bucket_id = 'chat-attachments'
            AND auth.role() = 'service_role'
        );
    END IF;
END $$;