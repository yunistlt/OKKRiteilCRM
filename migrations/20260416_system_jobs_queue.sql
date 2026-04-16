CREATE TABLE IF NOT EXISTS public.system_jobs (
    id BIGSERIAL PRIMARY KEY,
    job_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'dead_letter')),
    priority INT NOT NULL DEFAULT 100,
    idempotency_key TEXT UNIQUE,
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    locked_by TEXT,
    lock_expires_at TIMESTAMPTZ,
    last_error TEXT,
    result JSONB,
    parent_job_id BIGINT REFERENCES public.system_jobs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_jobs_ready
    ON public.system_jobs(status, available_at, priority, queued_at);

CREATE INDEX IF NOT EXISTS idx_system_jobs_type_status
    ON public.system_jobs(job_type, status, available_at);

CREATE INDEX IF NOT EXISTS idx_system_jobs_lock_expires
    ON public.system_jobs(lock_expires_at)
    WHERE lock_expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.touch_system_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS system_jobs_touch_updated_at ON public.system_jobs;

CREATE TRIGGER system_jobs_touch_updated_at
BEFORE UPDATE ON public.system_jobs
FOR EACH ROW
EXECUTE FUNCTION public.touch_system_jobs_updated_at();

CREATE OR REPLACE FUNCTION public.claim_system_jobs(
    p_worker_id TEXT,
    p_job_types TEXT[] DEFAULT NULL,
    p_limit INT DEFAULT 10,
    p_lock_seconds INT DEFAULT 300
)
RETURNS SETOF public.system_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH picked AS (
        SELECT job.id
        FROM public.system_jobs AS job
        WHERE job.status = 'queued'
          AND job.available_at <= NOW()
          AND (job.lock_expires_at IS NULL OR job.lock_expires_at <= NOW())
          AND (p_job_types IS NULL OR job.job_type = ANY(p_job_types))
        ORDER BY job.priority ASC, job.available_at ASC, job.queued_at ASC
        LIMIT GREATEST(COALESCE(p_limit, 1), 1)
        FOR UPDATE SKIP LOCKED
    ),
    updated AS (
        UPDATE public.system_jobs AS job
        SET status = 'processing',
            started_at = NOW(),
            locked_by = p_worker_id,
            lock_expires_at = NOW() + make_interval(secs => GREATEST(COALESCE(p_lock_seconds, 300), 30)),
            attempts = job.attempts + 1
        FROM picked
        WHERE job.id = picked.id
        RETURNING job.*
    )
    SELECT * FROM updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_system_job(
    p_job_id BIGINT,
    p_result JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.system_jobs
    SET status = 'completed',
        result = p_result,
        finished_at = NOW(),
        locked_by = NULL,
        lock_expires_at = NULL,
        last_error = NULL
    WHERE id = p_job_id;

    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_system_job(
    p_job_id BIGINT,
    p_error TEXT,
    p_retry_delay_seconds INT DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.system_jobs
    SET status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'queued' END,
        last_error = LEFT(COALESCE(p_error, 'Unknown error'), 4000),
        available_at = CASE
            WHEN attempts >= max_attempts THEN available_at
            ELSE NOW() + make_interval(secs => GREATEST(COALESCE(p_retry_delay_seconds, 60), 5))
        END,
        finished_at = CASE WHEN attempts >= max_attempts THEN NOW() ELSE NULL END,
        locked_by = NULL,
        lock_expires_at = NULL
    WHERE id = p_job_id;

    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.requeue_expired_system_jobs()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INT;
BEGIN
    UPDATE public.system_jobs
    SET status = 'queued',
        locked_by = NULL,
        lock_expires_at = NULL,
        available_at = NOW()
    WHERE status = 'processing'
      AND lock_expires_at IS NOT NULL
      AND lock_expires_at <= NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

ALTER TABLE public.system_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_jobs_service_role_select ON public.system_jobs;
CREATE POLICY system_jobs_service_role_select
    ON public.system_jobs
    FOR SELECT
    TO service_role
    USING (true);

DROP POLICY IF EXISTS system_jobs_service_role_write ON public.system_jobs;
CREATE POLICY system_jobs_service_role_write
    ON public.system_jobs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

REVOKE ALL ON public.system_jobs FROM anon;
REVOKE ALL ON public.system_jobs FROM authenticated;
GRANT ALL ON public.system_jobs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.system_jobs_id_seq TO service_role;

COMMENT ON TABLE public.system_jobs IS 'Универсальная очередь фоновых задач для near realtime пайплайна ОКК';
COMMENT ON COLUMN public.system_jobs.job_type IS 'Тип задачи: sync, match, transcription, scoring и другие';
COMMENT ON COLUMN public.system_jobs.idempotency_key IS 'Ключ дедупликации для безопасного повторного enqueue';
COMMENT ON FUNCTION public.claim_system_jobs(TEXT, TEXT[], INT, INT) IS 'Атомарно забирает batch задач в обработку';
COMMENT ON FUNCTION public.requeue_expired_system_jobs() IS 'Возвращает зависшие processing-задачи обратно в queued';