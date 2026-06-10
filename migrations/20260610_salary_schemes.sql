-- ============================================================================
-- Схемы оплаты (роли) и назначение их менеджерам. Схема — набор бонус-блоков
-- с параметрами (числа мотивации — в params). Менеджеру назначается схема
-- (effective-dated). НАЛИЧИЕ назначения = членство в реестре ОП: только эти
-- менеджеры попадают в расчёт ЗП. Резолв «на период» — последняя версия с
-- effective_from <= 1-е число месяца (как salary_config).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.salary_scheme (
    id             BIGSERIAL PRIMARY KEY,
    code           TEXT NOT NULL,             -- 'seller' | 'operator' | ...
    name           TEXT NOT NULL,             -- 'Продавец' | 'Оператор'
    effective_from DATE NOT NULL,
    note           TEXT,
    created_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (code, effective_from)
);

CREATE TABLE IF NOT EXISTS public.salary_scheme_block (
    id          BIGSERIAL PRIMARY KEY,
    scheme_id   BIGINT NOT NULL REFERENCES public.salary_scheme(id) ON DELETE CASCADE,
    block_code  TEXT NOT NULL,                -- ключ из каталога блоков (lib/salary/blocks)
    sort_order  INT NOT NULL DEFAULT 0,       -- порядок для drag-drop UI
    params      JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (scheme_id, block_code)
);

CREATE TABLE IF NOT EXISTS public.salary_manager_comp (
    id             BIGSERIAL PRIMARY KEY,
    manager_id     BIGINT NOT NULL REFERENCES public.managers(id) ON DELETE CASCADE,
    scheme_code    TEXT NOT NULL,
    effective_from DATE NOT NULL,
    created_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (manager_id, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_salary_manager_comp_mgr ON public.salary_manager_comp (manager_id, effective_from DESC);

-- ── Сид: схемы «Продавец» и «Оператор», действуют с 2026-05-01 ──────────────
-- Параметры блоков «Продавца» = текущие значения salary_config (20260608_salary_schema.sql),
-- чтобы расчёт май/июнь у продавцов не изменился. «Оператор» — только оклад 15 000.
INSERT INTO public.salary_scheme (code, name, effective_from, note, created_by) VALUES
    ('seller', 'Продавец', '2026-05-01', 'Полная мотивация: оклад + премия×К_кач + конв + скидка + К_команды + дежурства', 'system'),
    ('operator', 'Оператор', '2026-05-01', 'Приём звонков и занос сделок: только оклад', 'system')
ON CONFLICT (code, effective_from) DO NOTHING;

-- Блоки «Продавца»
INSERT INTO public.salary_scheme_block (scheme_id, block_code, sort_order, params)
SELECT s.id, v.block_code, v.sort_order, v.params::jsonb
FROM public.salary_scheme s
-- Премия за категории товара (режим «Сумма»). Категории — только реальные коды из
-- справочника RetailCRM (kategoriya_klienta); состав настраивается бизнесом в конструкторе.
JOIN (VALUES
    ('oklad',            1, '{"oklad":35000}'),
    ('premia_zayavki',   2, '{"rates":{"new":2000,"permanent":1000}}'),
    ('premia_categorii', 3, '{"rows":[{"category":"mufelnye-pechi","mode":"sum","value":3000},{"category":"sush_shso","mode":"sum","value":3000}]}'),
    ('k_quality',        4, '{"tiers":[{"min":90,"k":1.2},{"min":75,"k":1.1},{"min":60,"k":1.0},{"min":40,"k":0.9},{"min":0,"k":0.8}]}'),
    ('conv_bonus',       5, '{"tiers":[{"min":45,"bonus":9000},{"min":35,"bonus":6000},{"min":25,"bonus":3000},{"min":0,"bonus":0}],"minZayavki":10}'),
    ('discount_bonus',   6, '{"metric":"avg_order_discount_pct","comparator":"lte","threshold":5,"bonus":5000}'),
    ('k_team',           7, '{"tiers":[{"min":20000000,"k":1.3},{"min":16000000,"k":1.15},{"min":12000000,"k":1.0},{"min":0,"k":0.5}]}'),
    ('duty',             8, '{"rate":250}')
) AS v(block_code, sort_order, params) ON TRUE
WHERE s.code = 'seller' AND s.effective_from = '2026-05-01'
ON CONFLICT (scheme_id, block_code) DO NOTHING;

-- Блоки «Оператора» — только оклад 15 000
INSERT INTO public.salary_scheme_block (scheme_id, block_code, sort_order, params)
SELECT s.id, 'oklad', 1, '{"oklad":15000}'::jsonb
FROM public.salary_scheme s
WHERE s.code = 'operator' AND s.effective_from = '2026-05-01'
ON CONFLICT (scheme_id, block_code) DO NOTHING;

-- ── Назначения (реестр ОП) с 2026-05-01 ─────────────────────────────────────
-- Продавцы: Матвеева(98), Парфенова(10), Гордеева(249); Оператор: Хапилова(321).
-- Лариса(13, логист) и прочие НЕ назначены → в расчёт не попадают.
INSERT INTO public.salary_manager_comp (manager_id, scheme_code, effective_from, created_by) VALUES
    (98,  'seller',   '2026-05-01', 'system'),
    (10,  'seller',   '2026-05-01', 'system'),
    (249, 'seller',   '2026-05-01', 'system'),
    (321, 'operator', '2026-05-01', 'system')
ON CONFLICT (manager_id, effective_from) DO NOTHING;
