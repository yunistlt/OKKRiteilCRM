-- Профиль клиента считается раз в сутки, а не на каждый запрос.
--
-- Причина простая: разбор позиций всех заказов за три года с группировкой по
-- сферам занимает минуты. Утренний крон Vercel живёт пять, а менеджер ждать не
-- обязан вовсе. Данные суточной давности для разговора «что ещё вам предложить»
-- ничем не хуже свежих.

DROP MATERIALIZED VIEW IF EXISTS public.sales_client_purchases_mv CASCADE;
-- Одна строка на «заказ × категория»: в заказе бывает несколько позиций одной
-- категории, и без свёртки уникального ключа не получается, а он нужен.
CREATE MATERIALIZED VIEW public.sales_client_purchases_mv AS
    SELECT client_key,
           max(client_name) AS client_name,
           max(sphere_code) AS sphere_code,
           order_id,
           max(number) AS number,
           max(manager_id) AS manager_id,
           max(created_at) AS created_at,
           max(amount) AS amount,
           category
      FROM public.sales_client_purchases
     WHERE created_at >= now() - interval '36 months'
     GROUP BY client_key, order_id, category;

CREATE UNIQUE INDEX IF NOT EXISTS idx_scp_mv_uni
    ON public.sales_client_purchases_mv (client_key, order_id, category);
CREATE INDEX IF NOT EXISTS idx_scp_mv_client ON public.sales_client_purchases_mv (client_key);
CREATE INDEX IF NOT EXISTS idx_scp_mv_sphere ON public.sales_client_purchases_mv (sphere_code, category);

GRANT SELECT ON public.sales_client_purchases_mv TO service_role;

-- Профиль клиента: сколько покупал, на сколько, что берёт, кто ведёт.
DROP MATERIALIZED VIEW IF EXISTS public.sales_client_profile_mv CASCADE;
CREATE MATERIALIZED VIEW public.sales_client_profile_mv AS
    WITH per_order AS (
        SELECT client_key, order_id, max(client_name) client_name,
               max(sphere_code) sphere_code, max(manager_id) manager_id,
               max(created_at) created_at, max(amount) amount
          FROM public.sales_client_purchases_mv
         GROUP BY client_key, order_id
    )
    SELECT p.client_key,
           max(p.client_name) AS client_name,
           mode() WITHIN GROUP (ORDER BY p.sphere_code) AS sphere_code,
           mode() WITHIN GROUP (ORDER BY p.manager_id) AS manager_id,
           count(*) AS orders_count,
           sum(p.amount) AS total_amount,
           max(p.created_at) AS last_order_at,
           (SELECT array_agg(DISTINCT c.category)
              FROM public.sales_client_purchases_mv c WHERE c.client_key = p.client_key) AS own_categories
      FROM per_order p
     GROUP BY p.client_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_scprof_mv_uni ON public.sales_client_profile_mv (client_key);
CREATE INDEX IF NOT EXISTS idx_scprof_mv_mgr ON public.sales_client_profile_mv (manager_id);
GRANT SELECT ON public.sales_client_profile_mv TO service_role;

-- Что берут в сфере: частота категории по числу клиентов.
DROP MATERIALIZED VIEW IF EXISTS public.sales_sphere_category_mv CASCADE;
CREATE MATERIALIZED VIEW public.sales_sphere_category_mv AS
    SELECT sphere_code, category, count(DISTINCT client_key) AS clients
      FROM public.sales_client_purchases_mv
     WHERE category NOT IN ('Доставка', 'Аттестация', 'Прочее')
     GROUP BY sphere_code, category;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ssc_mv_uni ON public.sales_sphere_category_mv (sphere_code, category);
GRANT SELECT ON public.sales_sphere_category_mv TO service_role;

CREATE OR REPLACE FUNCTION public.sales_refresh_client_profiles()
RETURNS void LANGUAGE sql AS $function$
    REFRESH MATERIALIZED VIEW public.sales_client_purchases_mv;
    REFRESH MATERIALIZED VIEW public.sales_client_profile_mv;
    REFRESH MATERIALIZED VIEW public.sales_sphere_category_mv;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_refresh_client_profiles() TO service_role;

-- Кандидаты на развитие — теперь по готовым профилям.
DROP FUNCTION IF EXISTS public.sales_dev_candidates(int, int, int);
CREATE OR REPLACE FUNCTION public.sales_dev_candidates(
    p_min_orders int DEFAULT 2,
    p_min_days_since int DEFAULT 30,
    p_max_days_since int DEFAULT 540
)
RETURNS TABLE (
    client_key text, client_name text, sphere_name text,
    manager_id bigint, orders_count bigint, total_amount numeric, days_since int,
    own_categories text[], suggest_categories text[],
    last_order_id bigint, last_order_number text
)
LANGUAGE sql STABLE AS $function$
    SELECT c.client_key, c.client_name,
           coalesce(d.item_name, c.sphere_code, 'сфера не указана')::text,
           c.manager_id, c.orders_count, c.total_amount,
           EXTRACT(DAY FROM now() - c.last_order_at)::int,
           c.own_categories,
           (SELECT array_agg(s.category ORDER BY s.clients DESC)
              FROM (SELECT sc.category, sc.clients
                      FROM public.sales_sphere_category_mv sc
                     WHERE sc.sphere_code IS NOT DISTINCT FROM c.sphere_code
                       AND NOT (sc.category = ANY(c.own_categories))
                     ORDER BY sc.clients DESC LIMIT 3) s),
           (SELECT p.order_id FROM public.sales_client_purchases_mv p
             WHERE p.client_key = c.client_key ORDER BY p.created_at DESC LIMIT 1),
           (SELECT p.number::text FROM public.sales_client_purchases_mv p
             WHERE p.client_key = c.client_key ORDER BY p.created_at DESC LIMIT 1)
      FROM public.sales_client_profile_mv c
      LEFT JOIN public.retailcrm_dictionaries d
             ON d.dictionary_code = 'sfera_deiatelnosti' AND d.item_code = c.sphere_code
     WHERE c.orders_count >= p_min_orders
       AND EXTRACT(DAY FROM now() - c.last_order_at) BETWEEN p_min_days_since AND p_max_days_since;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_dev_candidates(int, int, int) TO service_role;

-- ── дисциплина менеджеров ─────────────────────────────────────────────────────
-- Накопленная статистика исполнения дневных планов. Нужна не для наказания, а
-- для распределения: заявки логично отдавать тому, кто отрабатывает выданное.
-- Показатель считается по сохранённым утренним задачам и вечерней сверке.
CREATE OR REPLACE FUNCTION public.sales_rop_discipline(p_days int DEFAULT 30)
RETURNS TABLE (
    manager_id bigint, manager_name text,
    tasks_total bigint, tasks_touched bigint, done_pct numeric,
    amount_untouched numeric, days_measured bigint
)
LANGUAGE sql STABLE AS $function$
    SELECT t.manager_id,
           trim(coalesce(m.last_name, '') || ' ' || coalesce(m.first_name, ''))::text,
           count(*),
           count(*) FILTER (WHERE t.touched),
           round(100.0 * count(*) FILTER (WHERE t.touched) / nullif(count(*), 0), 1),
           coalesce(sum(t.amount) FILTER (WHERE NOT coalesce(t.touched, false)), 0),
           count(DISTINCT t.plan_date)
      FROM public.sales_rop_task t
      LEFT JOIN public.managers m ON m.id = t.manager_id
     WHERE t.plan_date >= current_date - p_days
       -- Считаем только проверенные дни: непроверенный план — это наша недоработка,
       -- а не менеджера, и портить ему статистику ею нельзя.
       AND t.checked_at IS NOT NULL
     GROUP BY t.manager_id, m.last_name, m.first_name;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_discipline(int) TO service_role;
