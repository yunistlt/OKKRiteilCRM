-- Развитие клиентов: кому что ещё можно продать.
--
-- Цель владельца — 300 постоянных клиентов со средним чеком 3 млн в год. Из неё
-- следует, что работа с базой важнее потока заявок: клиент, который берёт один
-- и тот же шкаф третий год, — это не «работает», это недоработанный клиент.
--
-- Подсказка строится только на фактах: категории берутся из проданных позиций,
-- а «что ещё предложить» — из того, что покупают клиенты той же сферы
-- деятельности. Никаких выдуманных товаров: назвать клиенту то, чего мы не
-- делаем, хуже, чем не позвонить.

-- Категория товара выводится из названия. Правила лежат в таблице, потому что
-- ассортимент меняется, а деплой ради нового слова — плохая цена.
CREATE TABLE IF NOT EXISTS public.sales_category_rule (
    id       bigserial PRIMARY KEY,
    pattern  text NOT NULL,      -- ILIKE-шаблон по названию позиции
    category text NOT NULL,      -- человеческое имя категории, попадает в текст менеджеру
    ordinal  int NOT NULL DEFAULT 100,
    UNIQUE (pattern)
);

INSERT INTO public.sales_category_rule (pattern, category, ordinal) VALUES
    ('%сушильн%шкаф%', 'Сушильные шкафы', 10),
    ('%сушильн%стеллаж%', 'Сушильные стеллажи', 15),
    ('%муфельн%', 'Муфельные печи', 20),
    ('%камерн%печ%', 'Камерные печи', 25),
    ('%верстак%', 'Верстаки', 30),
    ('%автокомплект%', 'Автокомплекты', 35),
    ('%стеллаж%', 'Стеллажи', 40),
    ('%фланец%', 'Фланцы', 45),
    ('%держател%', 'Держатели', 50),
    ('%стол%', 'Столы', 55),
    ('%шкаф%', 'Шкафы металлические', 60),
    ('%тумб%', 'Тумбы', 65),
    ('%ящик%', 'Ящики', 70),
    ('%доставка%', 'Доставка', 900),
    ('%аттестац%', 'Аттестация', 910)
ON CONFLICT (pattern) DO NOTHING;

ALTER TABLE public.sales_category_rule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_category_rule_rw ON public.sales_category_rule;
CREATE POLICY sales_category_rule_rw ON public.sales_category_rule FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.sales_category_rule TO postgres, service_role;
GRANT ALL ON SEQUENCE public.sales_category_rule_id_seq TO postgres, service_role;

-- Категория позиции: первое подходящее правило по возрастанию ordinal.
-- «Доставка» и «аттестация» стоят в конце и с большим ordinal — они не товар,
-- но и терять их нельзя, иначе заказ выглядит пустым.
CREATE OR REPLACE FUNCTION public.sales_item_category(item_name text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $function$
    SELECT category FROM public.sales_category_rule
     WHERE item_name ILIKE pattern
     ORDER BY ordinal LIMIT 1;
$function$;

-- Что клиент реально купил: только заказы, дошедшие до производства и дальше.
-- Просчёты и отказы покупкой не считаются — на них нельзя строить разговор.
CREATE OR REPLACE VIEW public.sales_client_purchases AS
    SELECT
        coalesce(
            nullif(o.raw_payload->'contragent'->>'INN', ''),
            'cid:' || coalesce(o.raw_payload->'customer'->>'id', o.order_id::text)
        ) AS client_key,
        coalesce(nullif(o.raw_payload->'customer'->>'nickName', ''), 'клиент без названия') AS client_name,
        o.raw_payload->'customFields'->>'sfera_deiatelnosti' AS sphere_code,
        o.order_id, o.number, o.manager_id, o.created_at, coalesce(o.totalsumm, 0) AS amount,
        coalesce(public.sales_item_category(it->'offer'->>'name'), 'Прочее') AS category
      FROM public.orders o
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.raw_payload->'items', '[]'::jsonb)) it
     WHERE o.status IN ('send-assembling','zagruzen-systemu','complete','otgruzen','delivering',
                        'gotov-k-otgruzke','transport-doks','chast-otgruz','doks-polucen','postoplata')
       AND coalesce(o.totalsumm, 0) > 0;

COMMENT ON VIEW public.sales_client_purchases IS
    'Фактические покупки клиентов по категориям. Клиент склеивается по ИНН — один юрлицо часто заведено в CRM несколько раз.';

GRANT SELECT ON public.sales_client_purchases TO service_role;

-- Кандидаты на развитие и что им предложить.
--
-- Отбор: клиент покупал не меньше двух раз, последняя покупка не вчера и не в
-- прошлой жизни, а ассортимент узкий. Предложение — категории, которые берут
-- клиенты той же сферы, а этот не берёт, по убыванию частоты.
CREATE OR REPLACE FUNCTION public.sales_dev_candidates(
    p_min_orders int DEFAULT 2,
    p_min_days_since int DEFAULT 30,
    p_max_days_since int DEFAULT 540
)
RETURNS TABLE (
    client_key text, client_name text, sphere_code text, sphere_name text,
    manager_id bigint, orders_count bigint, total_amount numeric,
    last_order_at timestamptz, days_since int,
    own_categories text[], suggest_categories text[],
    sphere_median numeric, last_order_id bigint, last_order_number text
)
LANGUAGE sql STABLE AS $function$
    WITH client AS (
        SELECT client_key,
               max(client_name) AS client_name,
               mode() WITHIN GROUP (ORDER BY sphere_code) AS sphere_code,
               mode() WITHIN GROUP (ORDER BY manager_id) AS manager_id,
               count(DISTINCT order_id) AS orders_count,
               sum(DISTINCT amount) AS total_amount,
               max(created_at) AS last_order_at,
               array_agg(DISTINCT category) AS own_categories
          FROM public.sales_client_purchases
         WHERE created_at >= now() - interval '36 months'
         GROUP BY client_key
    ),
    -- Что берут в этой сфере вообще: частота категории по числу клиентов.
    sphere_cat AS (
        SELECT sphere_code, category, count(DISTINCT client_key) AS clients
          FROM public.sales_client_purchases
         WHERE created_at >= now() - interval '36 months'
         GROUP BY sphere_code, category
    ),
    sphere_money AS (
        SELECT sphere_code, percentile_cont(0.5) WITHIN GROUP (ORDER BY total) AS median_total
          FROM (
              SELECT sphere_code, client_key, sum(DISTINCT amount) AS total
                FROM public.sales_client_purchases
               WHERE created_at >= now() - interval '36 months'
               GROUP BY sphere_code, client_key
          ) t GROUP BY sphere_code
    ),
    suggestion AS (
        SELECT c.client_key,
               array_agg(sc.category ORDER BY sc.clients DESC) FILTER (WHERE sc.category NOT IN ('Доставка','Аттестация','Прочее'))
                   AS suggest
          FROM client c
          JOIN sphere_cat sc ON sc.sphere_code IS NOT DISTINCT FROM c.sphere_code
         WHERE NOT (sc.category = ANY(c.own_categories))
         GROUP BY c.client_key
    )
    SELECT c.client_key, c.client_name, c.sphere_code,
           coalesce(d.item_name, c.sphere_code, 'сфера не указана')::text,
           c.manager_id, c.orders_count, c.total_amount, c.last_order_at,
           EXTRACT(DAY FROM now() - c.last_order_at)::int,
           c.own_categories,
           (SELECT suggest[1:3] FROM suggestion s WHERE s.client_key = c.client_key),
           sm.median_total,
           (SELECT p.order_id FROM public.sales_client_purchases p
             WHERE p.client_key = c.client_key ORDER BY p.created_at DESC LIMIT 1),
           (SELECT p.number::text FROM public.sales_client_purchases p
             WHERE p.client_key = c.client_key ORDER BY p.created_at DESC LIMIT 1)
      FROM client c
      LEFT JOIN sphere_money sm ON sm.sphere_code IS NOT DISTINCT FROM c.sphere_code
      -- Имя сферы берём из справочника RetailCRM, а не придумываем.
      LEFT JOIN public.retailcrm_dictionaries d
             ON d.dictionary_code = 'sfera_deiatelnosti' AND d.item_code = c.sphere_code
     WHERE c.orders_count >= p_min_orders
       AND EXTRACT(DAY FROM now() - c.last_order_at) BETWEEN p_min_days_since AND p_max_days_since
       AND array_length(c.own_categories, 1) IS NOT NULL;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_dev_candidates(int, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_item_category(text) TO service_role;

INSERT INTO public.sales_rop_settings (key, value, comment) VALUES
    ('dev_per_day', '2', 'Сколько клиентов на развитие давать менеджеру в день'),
    ('dev_min_orders', '2', 'От скольких покупок клиент считается постоянным'),
    ('dev_min_days', '30', 'Не трогать клиента, если покупал совсем недавно'),
    ('dev_max_days', '540', 'Если покупал давнее этого срока — это уже не развитие, а реанимация')
ON CONFLICT (key) DO NOTHING;
