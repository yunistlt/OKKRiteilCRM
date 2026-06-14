-- ============================================================================
-- Грейды менеджеров ОП — авто-повышающийся ранг-множитель.
-- Грейд = ранг сотрудника: floor (низший, по умолч. 3) … top (высший, 1).
-- Растёт автоматически при выполнении показателей N месяцев ПОДРЯД, откатывается
-- при невыполнении ПОДРЯД, но не ниже floor. Это СОСТОЯНИЕ (не функция месяца):
--   • salary_grade      — леджер изменений грейда (effective-dated, как comp);
--   • salary_grade_eval — кэш помесячной оценки «зачтён/нет» (прозрачность отчёта);
--   • salary_config['grade_policy'] — политика (критерии/окно/пороги), ноль хардкода.
-- Множитель в формуле ЗП даёт ОТДЕЛЬНЫЙ блок 'grade_multiplier' (опционально в схеме),
-- который читает текущий грейд и берёт коэффициент из своих params-тиров.
-- ============================================================================

-- Леджер грейдов: запись = смена уровня с указанной даты. Текущий грейд на период =
-- последняя запись с effective_from <= 1-е число месяца (как salary_manager_comp).
CREATE TABLE IF NOT EXISTS public.salary_grade (
    id             BIGSERIAL PRIMARY KEY,
    manager_id     BIGINT NOT NULL REFERENCES public.managers(id) ON DELETE CASCADE,
    grade_level    INT NOT NULL,                 -- 1 = высший … floor = низший (по умолч. 3)
    effective_from DATE NOT NULL,                -- 1-е число месяца, с которого действует
    source         TEXT NOT NULL DEFAULT 'auto', -- 'auto' | 'manual' | 'seed'
    reason         JSONB,                        -- {change:+1|-1|0, prevLevel, qualStreak, failStreak, throughMonth}
    created_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (manager_id, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_salary_grade_mgr ON public.salary_grade (manager_id, effective_from DESC);

-- Кэш помесячной оценки: зачтён ли менеджеру месяц по критериям грейда (+ детализация).
CREATE TABLE IF NOT EXISTS public.salary_grade_eval (
    id           BIGSERIAL PRIMARY KEY,
    year         INT NOT NULL,
    month        INT NOT NULL,
    manager_id   BIGINT NOT NULL REFERENCES public.managers(id) ON DELETE CASCADE,
    scheme_code  TEXT,                           -- роль на тот месяц (когорта сравнения)
    qualified    BOOLEAN NOT NULL,
    detail       JSONB,                          -- [{metric, value, mode, passed, rank?, cutoff?}]
    computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (year, month, manager_id)
);
CREATE INDEX IF NOT EXISTS idx_salary_grade_eval_period ON public.salary_grade_eval (year, month);

-- ── Сид политики грейдов (effective с 2026-01-01, чтобы действовала для всех периодов) ──
-- floor=3 (ниже не падаем), top=1; повышение за 3 мес. подряд, откат за 2 мес. подряд;
-- глубина анализа 6 мес.; когорта сравнения — та же роль (scheme). Критерии:
--   • выполнение личного плана ≥ 100% (абсолютный порог);
--   • топ-1 отдела по конверсии / скорингу ОКК / среднему чеку (dept_rank).
INSERT INTO public.salary_config (key, value, effective_from, note, created_by) VALUES (
    'grade_policy',
    '{
        "floorLevel": 3,
        "topLevel": 1,
        "lookbackMonths": 6,
        "promoteAfterMonths": 3,
        "demoteAfterMonths": 2,
        "cohort": "scheme",
        "criteria": [
            { "metric": "plan_attainment", "mode": "absolute", "comparator": "gte", "threshold": 100, "required": true },
            { "metric": "conversion",      "mode": "dept_rank", "rank": 1, "required": true },
            { "metric": "okk_total_score", "mode": "dept_rank", "rank": 1, "required": true },
            { "metric": "avg_check",       "mode": "dept_rank", "rank": 1, "required": true }
        ]
    }'::jsonb,
    '2026-01-01',
    'Политика грейдов: floor 3 / top 1, +1 за 3 мес. подряд, −1 за 2 мес. подряд, окно 6 мес., когорта — роль',
    'system'
) ON CONFLICT (key, effective_from) DO NOTHING;
