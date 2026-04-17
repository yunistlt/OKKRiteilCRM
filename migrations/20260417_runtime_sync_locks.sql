CREATE TABLE IF NOT EXISTS public.runtime_sync_locks (
    lock_key TEXT PRIMARY KEY,
    holder TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.touch_runtime_sync_locks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS runtime_sync_locks_touch_updated_at ON public.runtime_sync_locks;

CREATE TRIGGER runtime_sync_locks_touch_updated_at
BEFORE UPDATE ON public.runtime_sync_locks
FOR EACH ROW
EXECUTE FUNCTION public.touch_runtime_sync_locks_updated_at();

CREATE OR REPLACE FUNCTION public.try_acquire_runtime_sync_lock(
    p_lock_key TEXT,
    p_holder TEXT,
    p_ttl_seconds INT DEFAULT 300
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_expires_at TIMESTAMPTZ := NOW() + make_interval(secs => GREATEST(COALESCE(p_ttl_seconds, 300), 30));
    v_row_count INT := 0;
BEGIN
    INSERT INTO public.runtime_sync_locks (lock_key, holder, expires_at)
    VALUES (p_lock_key, p_holder, v_expires_at)
    ON CONFLICT (lock_key) DO UPDATE
    SET holder = EXCLUDED.holder,
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()
    WHERE public.runtime_sync_locks.expires_at <= NOW()
       OR public.runtime_sync_locks.holder = EXCLUDED.holder;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    RETURN v_row_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_runtime_sync_lock(
    p_lock_key TEXT,
    p_holder TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.runtime_sync_locks
    WHERE lock_key = p_lock_key
      AND holder = p_holder;

    RETURN FOUND;
END;
$$;

ALTER TABLE public.runtime_sync_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS runtime_sync_locks_service_role_select ON public.runtime_sync_locks;
CREATE POLICY runtime_sync_locks_service_role_select
    ON public.runtime_sync_locks
    FOR SELECT
    TO service_role
    USING (true);

DROP POLICY IF EXISTS runtime_sync_locks_service_role_write ON public.runtime_sync_locks;
CREATE POLICY runtime_sync_locks_service_role_write
    ON public.runtime_sync_locks
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

REVOKE ALL ON public.runtime_sync_locks FROM anon;
REVOKE ALL ON public.runtime_sync_locks FROM authenticated;
GRANT ALL ON public.runtime_sync_locks TO service_role;

COMMENT ON TABLE public.runtime_sync_locks IS 'Короткоживущие distributed lease locks для sync/worker маршрутов вне system_jobs';
COMMENT ON FUNCTION public.try_acquire_runtime_sync_lock(TEXT, TEXT, INT) IS 'Пытается атомарно получить runtime lease lock с TTL';
COMMENT ON FUNCTION public.release_runtime_sync_lock(TEXT, TEXT) IS 'Освобождает runtime lease lock, если holder совпадает';