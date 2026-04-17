CREATE OR REPLACE FUNCTION public.claim_system_jobs(
    p_worker_id TEXT,
    p_job_types TEXT[] DEFAULT NULL,
    p_limit INT DEFAULT 10,
    p_lock_seconds INT DEFAULT 300,
    p_max_processing INT DEFAULT NULL,
    p_concurrency_key TEXT DEFAULT NULL
)
RETURNS SETOF public.system_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_limit INT;
    v_active_processing INT := 0;
BEGIN
    IF p_concurrency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(p_concurrency_key, 0));
    END IF;

    v_limit := GREATEST(COALESCE(p_limit, 1), 1);

    IF p_max_processing IS NOT NULL THEN
        SELECT COUNT(*)
        INTO v_active_processing
        FROM public.system_jobs AS job
        WHERE job.status = 'processing'
          AND (job.lock_expires_at IS NULL OR job.lock_expires_at > NOW())
          AND (p_job_types IS NULL OR job.job_type = ANY(p_job_types));

        v_limit := LEAST(v_limit, GREATEST(p_max_processing - v_active_processing, 0));
    END IF;

    IF v_limit <= 0 THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH picked AS (
        SELECT job.id
        FROM public.system_jobs AS job
        WHERE job.status = 'queued'
          AND job.available_at <= NOW()
          AND (job.lock_expires_at IS NULL OR job.lock_expires_at <= NOW())
          AND (p_job_types IS NULL OR job.job_type = ANY(p_job_types))
        ORDER BY job.priority ASC, job.available_at ASC, job.queued_at ASC
        LIMIT v_limit
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

COMMENT ON FUNCTION public.claim_system_jobs(TEXT, TEXT[], INT, INT, INT, TEXT)
IS 'Атомарно забирает batch задач в обработку с optional global concurrency cap и advisory lock по worker-group';