-- RBAC foundation: profiles, auth claims sync and strict RLS policies.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'app_role' AND n.nspname = 'public'
    ) THEN
        CREATE TYPE public.app_role AS ENUM ('admin', 'okk', 'rop', 'manager');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    avatar_url TEXT,
    role public.app_role NOT NULL DEFAULT 'manager',
    retail_crm_manager_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_unique
    ON public.profiles (lower(email))
    WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_unique
    ON public.profiles (lower(username))
    WHERE username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles (role);
CREATE INDEX IF NOT EXISTS idx_profiles_retailcrm_manager ON public.profiles (retail_crm_manager_id);

CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_current_timestamp_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    INSERT INTO public.profiles (
        id,
        email,
        username,
        first_name,
        last_name,
        role,
        retail_crm_manager_id
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data ->> 'username', split_part(NEW.email, '@', 1)),
        NEW.raw_user_meta_data ->> 'first_name',
        NEW.raw_user_meta_data ->> 'last_name',
        COALESCE((NEW.raw_app_meta_data ->> 'role')::public.app_role, 'manager'::public.app_role),
        NULLIF(NEW.raw_app_meta_data ->> 'retail_crm_manager_id', '')::BIGINT
    )
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        username = COALESCE(EXCLUDED.username, public.profiles.username),
        first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
        last_name = COALESCE(EXCLUDED.last_name, public.profiles.last_name);

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_profile_claims_to_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    UPDATE auth.users
    SET email = COALESCE(NEW.email, auth.users.email),
        raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
            || jsonb_build_object(
                'role', NEW.role,
                'retail_crm_manager_id', NEW.retail_crm_manager_id,
                'username', NEW.username,
                'first_name', NEW.first_name,
                'last_name', NEW.last_name
            )
    WHERE id = NEW.id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profiles ON auth.users;
CREATE TRIGGER on_auth_user_created_profiles
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_auth_user();

DROP TRIGGER IF EXISTS trg_profiles_sync_claims ON public.profiles;
CREATE TRIGGER trg_profiles_sync_claims
    AFTER INSERT OR UPDATE OF email, username, first_name, last_name, role, retail_crm_manager_id
    ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_profile_claims_to_auth();

INSERT INTO public.profiles (id, email, username)
SELECT au.id, au.email, split_part(au.email, '@', 1)
FROM auth.users au
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
    users_has_email BOOLEAN;
    users_has_username BOOLEAN;
    users_has_first_name BOOLEAN;
    users_has_last_name BOOLEAN;
    users_has_avatar_url BOOLEAN;
    users_has_role BOOLEAN;
    users_has_retail_crm_manager_id BOOLEAN;
    merge_sql TEXT;
BEGIN
    IF to_regclass('public.users') IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'email'
        ) INTO users_has_email;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'username'
        ) INTO users_has_username;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'first_name'
        ) INTO users_has_first_name;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'last_name'
        ) INTO users_has_last_name;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'avatar_url'
        ) INTO users_has_avatar_url;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'role'
        ) INTO users_has_role;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'retail_crm_manager_id'
        ) INTO users_has_retail_crm_manager_id;

        merge_sql := format(
            $sql$
                UPDATE public.profiles p
                SET email = COALESCE(%1$s, p.email),
                    username = COALESCE(%2$s, p.username),
                    first_name = COALESCE(%3$s, p.first_name),
                    last_name = COALESCE(%4$s, p.last_name),
                    avatar_url = COALESCE(%5$s, p.avatar_url),
                    role = COALESCE(%6$s, p.role),
                    retail_crm_manager_id = COALESCE(%7$s, p.retail_crm_manager_id)
                FROM public.users u
                WHERE u.id = p.id
            $sql$,
            CASE WHEN users_has_email THEN 'u.email' ELSE 'NULL' END,
            CASE WHEN users_has_username THEN 'u.username' ELSE 'NULL' END,
            CASE WHEN users_has_first_name THEN 'u.first_name' ELSE 'NULL' END,
            CASE WHEN users_has_last_name THEN 'u.last_name' ELSE 'NULL' END,
            CASE WHEN users_has_avatar_url THEN 'u.avatar_url' ELSE 'NULL' END,
            CASE
                WHEN users_has_role THEN
                    'CASE WHEN u.role IN (''admin'', ''okk'', ''rop'', ''manager'') THEN u.role::public.app_role ELSE NULL END'
                ELSE 'NULL'
            END,
            CASE WHEN users_has_retail_crm_manager_id THEN 'u.retail_crm_manager_id' ELSE 'NULL' END
        );

        EXECUTE merge_sql;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.jwt_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        NULLIF(auth.jwt() ->> 'role', '')::public.app_role,
        NULLIF(auth.jwt() -> 'app_metadata' ->> 'role', '')::public.app_role,
        'manager'::public.app_role
    )
$$;

CREATE OR REPLACE FUNCTION public.jwt_retail_crm_manager_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        NULLIF(auth.jwt() ->> 'retail_crm_manager_id', '')::BIGINT,
        NULLIF(auth.jwt() -> 'app_metadata' ->> 'retail_crm_manager_id', '')::BIGINT
    )
$$;

CREATE OR REPLACE FUNCTION public.has_full_order_access()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT public.jwt_role() IN ('admin', 'okk', 'rop')
$$;

CREATE OR REPLACE FUNCTION public.can_access_manager_row(target_manager_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT
        public.has_full_order_access()
        OR (
            public.jwt_role() = 'manager'
            AND public.jwt_retail_crm_manager_id() IS NOT NULL
            AND target_manager_id IS NOT NULL
            AND public.jwt_retail_crm_manager_id() = target_manager_id
        )
$$;

CREATE OR REPLACE FUNCTION public.can_access_order(order_public_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.order_id = order_public_id
          AND public.can_access_manager_row(o.manager_id)
    )
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF to_regclass('public.users') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.users ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS users_service_role_only ON public.users';
        EXECUTE $sql$
            CREATE POLICY users_service_role_only
            ON public.users
            FOR ALL
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role')
        $sql$;
    END IF;
END $$;

DROP POLICY IF EXISTS profiles_self_or_admin_select ON public.profiles;
CREATE POLICY profiles_self_or_admin_select
    ON public.profiles
    FOR SELECT
    USING (auth.uid() = id OR public.jwt_role() = 'admin');

DROP POLICY IF EXISTS profiles_self_or_admin_update ON public.profiles;
CREATE POLICY profiles_self_or_admin_update
    ON public.profiles
    FOR UPDATE
    USING (auth.uid() = id OR public.jwt_role() = 'admin')
    WITH CHECK (auth.uid() = id OR public.jwt_role() = 'admin');

DROP POLICY IF EXISTS profiles_admin_insert ON public.profiles;
CREATE POLICY profiles_admin_insert
    ON public.profiles
    FOR INSERT
    WITH CHECK (public.jwt_role() = 'admin');

DO $$
BEGIN
    IF to_regclass('public.orders') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS orders_select_by_role ON public.orders';
        EXECUTE 'DROP POLICY IF EXISTS "Allow all for service role" ON public.orders';
        EXECUTE $sql$
            CREATE POLICY orders_select_by_role
            ON public.orders
            FOR SELECT
            USING (public.can_access_manager_row(manager_id))
        $sql$;
        EXECUTE 'DROP POLICY IF EXISTS orders_service_role_write ON public.orders';
        EXECUTE $sql$
            CREATE POLICY orders_service_role_write
            ON public.orders
            FOR ALL
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role')
        $sql$;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.okk_order_scores') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.okk_order_scores ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS okk_order_scores_select_by_role ON public.okk_order_scores';
        EXECUTE 'DROP POLICY IF EXISTS "Allow all for service role" ON public.okk_order_scores';
        EXECUTE $sql$
            CREATE POLICY okk_order_scores_select_by_role
            ON public.okk_order_scores
            FOR SELECT
            USING (public.can_access_manager_row(manager_id))
        $sql$;
        EXECUTE 'DROP POLICY IF EXISTS okk_order_scores_service_role_write ON public.okk_order_scores';
        EXECUTE $sql$
            CREATE POLICY okk_order_scores_service_role_write
            ON public.okk_order_scores
            FOR ALL
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role')
        $sql$;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.order_metrics') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.order_metrics ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS order_metrics_select_by_role ON public.order_metrics';
        EXECUTE 'DROP POLICY IF EXISTS "Allow all for service role" ON public.order_metrics';
        EXECUTE $sql$
            CREATE POLICY order_metrics_select_by_role
            ON public.order_metrics
            FOR SELECT
            USING (public.can_access_manager_row(manager_id))
        $sql$;
        EXECUTE 'DROP POLICY IF EXISTS order_metrics_service_role_write ON public.order_metrics';
        EXECUTE $sql$
            CREATE POLICY order_metrics_service_role_write
            ON public.order_metrics
            FOR ALL
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role')
        $sql$;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.call_order_matches') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.call_order_matches ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS call_order_matches_select_by_role ON public.call_order_matches';
        EXECUTE 'DROP POLICY IF EXISTS "Allow all for service role" ON public.call_order_matches';
        EXECUTE $sql$
            CREATE POLICY call_order_matches_select_by_role
            ON public.call_order_matches
            FOR SELECT
            USING (public.can_access_order(retailcrm_order_id))
        $sql$;
        EXECUTE 'DROP POLICY IF EXISTS call_order_matches_service_role_write ON public.call_order_matches';
        EXECUTE $sql$
            CREATE POLICY call_order_matches_service_role_write
            ON public.call_order_matches
            FOR ALL
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role')
        $sql$;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.raw_order_events') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.raw_order_events ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS raw_order_events_select_by_role ON public.raw_order_events';
        EXECUTE 'DROP POLICY IF EXISTS "Allow all for service role" ON public.raw_order_events';
        EXECUTE $sql$
            CREATE POLICY raw_order_events_select_by_role
            ON public.raw_order_events
            FOR SELECT
            USING (public.can_access_order(retailcrm_order_id))
        $sql$;
        EXECUTE 'DROP POLICY IF EXISTS raw_order_events_service_role_write ON public.raw_order_events';
        EXECUTE $sql$
            CREATE POLICY raw_order_events_service_role_write
            ON public.raw_order_events
            FOR ALL
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role')
        $sql$;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.raw_telphin_calls') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.raw_telphin_calls ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS raw_telphin_calls_select_by_role ON public.raw_telphin_calls';
        EXECUTE 'DROP POLICY IF EXISTS "Allow all for service role" ON public.raw_telphin_calls';
        EXECUTE $sql$
            CREATE POLICY raw_telphin_calls_select_by_role
            ON public.raw_telphin_calls
            FOR SELECT
            USING (
                public.has_full_order_access()
                OR EXISTS (
                    SELECT 1
                    FROM public.call_order_matches com
                    JOIN public.orders o ON o.order_id = com.retailcrm_order_id
                    WHERE com.telphin_call_id = raw_telphin_calls.telphin_call_id
                      AND public.can_access_manager_row(o.manager_id)
                )
            )
        $sql$;
        EXECUTE 'DROP POLICY IF EXISTS raw_telphin_calls_service_role_write ON public.raw_telphin_calls';
        EXECUTE $sql$
            CREATE POLICY raw_telphin_calls_service_role_write
            ON public.raw_telphin_calls
            FOR ALL
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role')
        $sql$;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.okk_violations') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.okk_violations ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS okk_violations_select_by_role ON public.okk_violations';
        EXECUTE 'DROP POLICY IF EXISTS "Enable read rights for all users" ON public.okk_violations';
        EXECUTE $sql$
            CREATE POLICY okk_violations_select_by_role
            ON public.okk_violations
            FOR SELECT
            USING (public.can_access_order(order_id))
        $sql$;
        EXECUTE 'DROP POLICY IF EXISTS okk_violations_service_role_write ON public.okk_violations';
        EXECUTE 'DROP POLICY IF EXISTS "Enable insert for service role only" ON public.okk_violations';
        EXECUTE $sql$
            CREATE POLICY okk_violations_service_role_write
            ON public.okk_violations
            FOR ALL
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role')
        $sql$;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.order_history_log') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.order_history_log ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS order_history_log_select_by_role ON public.order_history_log';
        EXECUTE 'DROP POLICY IF EXISTS "Allow all for authenticated" ON public.order_history_log';
        EXECUTE $sql$
            CREATE POLICY order_history_log_select_by_role
            ON public.order_history_log
            FOR SELECT
            USING (public.can_access_order(retailcrm_order_id))
        $sql$;
        EXECUTE 'DROP POLICY IF EXISTS order_history_log_service_role_write ON public.order_history_log';
        EXECUTE $sql$
            CREATE POLICY order_history_log_service_role_write
            ON public.order_history_log
            FOR ALL
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role')
        $sql$;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.okk_consultant_threads') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.okk_consultant_threads ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS okk_consultant_threads_select ON public.okk_consultant_threads';
        EXECUTE $sql$
            CREATE POLICY okk_consultant_threads_select
            ON public.okk_consultant_threads
            FOR SELECT
            USING (
                public.jwt_role() IN ('admin', 'okk', 'rop')
                OR user_id::uuid = auth.uid()
            )
        $sql$;
        EXECUTE 'DROP POLICY IF EXISTS okk_consultant_threads_service_role_write ON public.okk_consultant_threads';
        EXECUTE $sql$
            CREATE POLICY okk_consultant_threads_service_role_write
            ON public.okk_consultant_threads
            FOR ALL
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role')
        $sql$;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.okk_consultant_messages') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.okk_consultant_messages ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS okk_consultant_messages_select ON public.okk_consultant_messages';
        EXECUTE $sql$
            CREATE POLICY okk_consultant_messages_select
            ON public.okk_consultant_messages
            FOR SELECT
            USING (
                public.jwt_role() IN ('admin', 'okk', 'rop')
                OR EXISTS (
                    SELECT 1
                    FROM public.okk_consultant_threads t
                    WHERE t.id = okk_consultant_messages.thread_id
                      AND t.user_id::uuid = auth.uid()
                )
            )
        $sql$;
        EXECUTE 'DROP POLICY IF EXISTS okk_consultant_messages_service_role_write ON public.okk_consultant_messages';
        EXECUTE $sql$
            CREATE POLICY okk_consultant_messages_service_role_write
            ON public.okk_consultant_messages
            FOR ALL
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role')
        $sql$;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.okk_consultant_logs') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.okk_consultant_logs ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS okk_consultant_logs_select ON public.okk_consultant_logs';
        EXECUTE $sql$
            CREATE POLICY okk_consultant_logs_select
            ON public.okk_consultant_logs
            FOR SELECT
            USING (
                public.jwt_role() IN ('admin', 'okk', 'rop')
                OR user_id::uuid = auth.uid()
            )
        $sql$;
        EXECUTE 'DROP POLICY IF EXISTS okk_consultant_logs_service_role_write ON public.okk_consultant_logs';
        EXECUTE $sql$
            CREATE POLICY okk_consultant_logs_service_role_write
            ON public.okk_consultant_logs
            FOR ALL
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role')
        $sql$;
    END IF;
END $$;

REVOKE ALL ON public.users FROM anon, authenticated;
GRANT ALL ON public.users TO service_role;

REVOKE ALL ON public.profiles FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

REVOKE ALL ON public.orders FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.orders FROM authenticated;
GRANT SELECT ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;

REVOKE ALL ON public.okk_order_scores FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.okk_order_scores FROM authenticated;
GRANT SELECT ON public.okk_order_scores TO authenticated;
GRANT ALL ON public.okk_order_scores TO service_role;

REVOKE ALL ON public.order_metrics FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.order_metrics FROM authenticated;
GRANT SELECT ON public.order_metrics TO authenticated;
GRANT ALL ON public.order_metrics TO service_role;

REVOKE ALL ON public.call_order_matches FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.call_order_matches FROM authenticated;
GRANT SELECT ON public.call_order_matches TO authenticated;
GRANT ALL ON public.call_order_matches TO service_role;

REVOKE ALL ON public.raw_order_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.raw_order_events FROM authenticated;
GRANT SELECT ON public.raw_order_events TO authenticated;
GRANT ALL ON public.raw_order_events TO service_role;

REVOKE ALL ON public.raw_telphin_calls FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.raw_telphin_calls FROM authenticated;
GRANT SELECT ON public.raw_telphin_calls TO authenticated;
GRANT ALL ON public.raw_telphin_calls TO service_role;

REVOKE ALL ON public.okk_violations FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.okk_violations FROM authenticated;
GRANT SELECT ON public.okk_violations TO authenticated;
GRANT ALL ON public.okk_violations TO service_role;

REVOKE ALL ON public.order_history_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.order_history_log FROM authenticated;
GRANT SELECT ON public.order_history_log TO authenticated;
GRANT ALL ON public.order_history_log TO service_role;

COMMENT ON TABLE public.profiles IS 'RBAC profiles bound 1:1 to auth.users with role and RetailCRM manager mapping.';
COMMENT ON COLUMN public.profiles.retail_crm_manager_id IS 'RetailCRM manager id used for manager-scoped order filtering in RLS and JWT claims.';
COMMENT ON FUNCTION public.jwt_role() IS 'Returns role from JWT claims for RLS checks.';
COMMENT ON FUNCTION public.jwt_retail_crm_manager_id() IS 'Returns RetailCRM manager id from JWT claims for manager-scoped RLS.';

-- Test users should be created in Supabase Auth (Dashboard/Admin API), then assigned via public.profiles.