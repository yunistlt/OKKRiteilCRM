-- Ускорение пересборки канона клиентов ЗП (salary_rebuild_client_canon).
--
-- Проблема: функция читала raw_payload ВСЕХ заказов (30 512 строк, 119 МБ JSONB) на
-- каждый вызов — 9 с, при лимите запроса Supabase REST 8 с. Из-за отмены падал
-- recalcAndPersist, и период не закрывался (инцидент 02.09.2026: август).
--
-- Решение: рёбра графа «карточка ↔ ключ (ИНН/компания)» материализуются один раз в
-- salary_client_edges и обновляются ИНКРЕМЕНТАЛЬНО — только по заказам, изменённым с
-- прошлого запуска. Тяжёлый разбор JSON уходит из горячего пути; склейка (label
-- propagation) считается по узкой таблице без JSONB.
--
-- Результат идентичен прежнему: те же ключи, та же транзитивная склейка, канон —
-- минимальный customer.id компоненты.

CREATE TABLE IF NOT EXISTS public.salary_client_edges (
    order_id   bigint PRIMARY KEY,
    cust_id    bigint NOT NULL,
    inn        text,
    company_id text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salary_client_edges_cust ON public.salary_client_edges (cust_id);
CREATE INDEX IF NOT EXISTS idx_salary_client_edges_inn ON public.salary_client_edges (inn) WHERE inn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_salary_client_edges_company ON public.salary_client_edges (company_id) WHERE company_id IS NOT NULL;

COMMENT ON TABLE public.salary_client_edges IS
    'Разобранные из orders.raw_payload ключи склейки клиента (customer.id ↔ ИНН/компания). Обновляется инкрементально в salary_rebuild_client_canon().';

-- Отметка «до какого времени изменения заказов уже разобраны».
CREATE TABLE IF NOT EXISTS public.salary_client_canon_state (
    id              boolean PRIMARY KEY DEFAULT true CHECK (id),
    orders_synced_to timestamptz
);
INSERT INTO public.salary_client_canon_state (id, orders_synced_to)
VALUES (true, NULL) ON CONFLICT (id) DO NOTHING;

-- Инкремент ищется по orders.updated_at — без индекса это тот же seq scan.
CREATE INDEX IF NOT EXISTS idx_orders_updated_at ON public.orders (updated_at);

-- Разбор заказов в рёбра. p_since = NULL → полный разбор.
CREATE OR REPLACE FUNCTION public.salary_sync_client_edges(p_since timestamptz DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    v_rows bigint;
BEGIN
    INSERT INTO public.salary_client_edges (order_id, cust_id, inn, company_id, updated_at)
    SELECT o.order_id,
           x.cust_id,
           CASE WHEN x.inn ~ '^[0-9]{10,12}$' THEN x.inn END,
           CASE WHEN x.company_id ~ '^[0-9]+$' THEN x.company_id END,
           now()
    FROM public.orders o
    CROSS JOIN LATERAL (
        SELECT COALESCE(
                   CASE WHEN o.raw_payload->'customer'->>'id' ~ '^[0-9]+$'
                        THEN (o.raw_payload->'customer'->>'id')::bigint END,
                   o.client_id
               ) AS cust_id,
               NULLIF(regexp_replace(
                   COALESCE(
                       o.raw_payload->'contragent'->>'INN',
                       o.raw_payload->'company'->'contragent'->>'INN',
                       ''
                   ), '\D', '', 'g'), '') AS inn,
               NULLIF(o.raw_payload->'company'->>'id', '') AS company_id
    ) x
    WHERE x.cust_id IS NOT NULL
      AND (p_since IS NULL OR o.updated_at > p_since)
    ON CONFLICT (order_id) DO UPDATE
        SET cust_id = EXCLUDED.cust_id,
            inn = EXCLUDED.inn,
            company_id = EXCLUDED.company_id,
            updated_at = now()
        WHERE public.salary_client_edges.cust_id IS DISTINCT FROM EXCLUDED.cust_id
           OR public.salary_client_edges.inn IS DISTINCT FROM EXCLUDED.inn
           OR public.salary_client_edges.company_id IS DISTINCT FROM EXCLUDED.company_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$function$;

-- Старая безаргументная версия удаляется: иначе вызов salary_rebuild_client_canon()
-- станет неоднозначным (0-арная против новой с DEFAULT).
DROP FUNCTION IF EXISTS public.salary_rebuild_client_canon();

-- Пересборка канона. По умолчанию инкрементальная: разбираются только заказы,
-- изменённые с прошлого запуска. p_full = true — полный разбор (ночной крон).
CREATE OR REPLACE FUNCTION public.salary_rebuild_client_canon(p_full boolean DEFAULT false)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    v_rows      bigint;
    v_changed   bigint;
    v_iter      int := 0;
    v_since     timestamptz;
    v_watermark timestamptz;
BEGIN
    -- Верхняя граница инкремента фиксируется ДО разбора: заказы, изменённые во время
    -- работы функции, попадут в следующий запуск, а не потеряются между окнами.
    SELECT max(updated_at) INTO v_watermark FROM public.orders;

    IF p_full THEN
        v_since := NULL;
    ELSE
        SELECT orders_synced_to INTO v_since FROM public.salary_client_canon_state WHERE id;
    END IF;

    PERFORM public.salary_sync_client_edges(v_since);

    UPDATE public.salary_client_canon_state SET orders_synced_to = v_watermark WHERE id;

    -- Рёбра «карточка ↔ ключ». Компания (company.id) — только запасной ключ для
    -- карточек, у которых ИНН не выгружен ни в одном заказе: связывать по ней
    -- карточки с ИНН значит стягивать разные юрлица.
    CREATE TEMP TABLE _edges ON COMMIT DROP AS
    WITH has_inn AS (
        SELECT DISTINCT cust_id FROM public.salary_client_edges WHERE inn IS NOT NULL
    )
    SELECT DISTINCT cust_id, 'inn:' || inn AS group_key
    FROM public.salary_client_edges WHERE inn IS NOT NULL
    UNION
    SELECT DISTINCT e.cust_id, 'comp:' || e.company_id
    FROM public.salary_client_edges e
    WHERE e.company_id IS NOT NULL
      AND e.cust_id NOT IN (SELECT cust_id FROM has_inn);

    CREATE INDEX ON _edges (group_key);
    CREATE INDEX ON _edges (cust_id);

    -- Метка карточки = минимальный cust_id её компоненты связности.
    CREATE TEMP TABLE _label ON COMMIT DROP AS
    SELECT DISTINCT cust_id, cust_id AS label FROM public.salary_client_edges;

    CREATE UNIQUE INDEX ON _label (cust_id);

    -- Итерации до стабилизации. Компоненты мелкие (единицы карточек), реально
    -- хватает 2–4 проходов; 50 — страховка от зацикливания.
    LOOP
        v_iter := v_iter + 1;

        WITH key_min AS (
            SELECT e.group_key, min(l.label) AS m
            FROM _edges e JOIN _label l USING (cust_id)
            GROUP BY e.group_key
        ),
        cust_min AS (
            SELECT e.cust_id, min(k.m) AS m
            FROM _edges e JOIN key_min k USING (group_key)
            GROUP BY e.cust_id
        )
        UPDATE _label l
        SET label = c.m
        FROM cust_min c
        WHERE c.cust_id = l.cust_id AND c.m < l.label;

        GET DIAGNOSTICS v_changed = ROW_COUNT;
        EXIT WHEN v_changed = 0 OR v_iter >= 50;
    END LOOP;

    INSERT INTO public.salary_client_canon (cust_id, canon_id, group_key, updated_at)
    SELECT l.cust_id, l.label, 'canon:' || l.label::text, now()
    FROM _label l
    ON CONFLICT (cust_id) DO UPDATE
        SET canon_id = EXCLUDED.canon_id,
            group_key = EXCLUDED.group_key,
            updated_at = now()
        WHERE public.salary_client_canon.canon_id IS DISTINCT FROM EXCLUDED.canon_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$function$;

-- Первичное наполнение рёбер (единственный полный проход по raw_payload).
SELECT public.salary_rebuild_client_canon(true);
