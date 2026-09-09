-- Сегмент клиента по его сфере деятельности.
--
-- Без этого правила карты подбирались только по товару, и энергетическая
-- компания, купившая сушильные шкафы, получала совет про скамейки в раздевалку
-- детского сада: триггер «Сушильные шкафы» есть у обоих сегментов. Товар
-- одинаковый, задача разная — и именно задача решает, что предлагать.
--
-- Сферы берутся из справочника RetailCRM, имена оттуда же. Сфера, которой здесь
-- нет, сегмента не получает — и тогда подсказка не показывается вовсе.
-- Промолчать честнее, чем посоветовать наугад.

CREATE TABLE IF NOT EXISTS public.sales_segment_map (
    sphere_code text PRIMARY KEY,
    segment     text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sales_segment_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_segment_map_rw ON public.sales_segment_map;
CREATE POLICY sales_segment_map_rw ON public.sales_segment_map FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.sales_segment_map TO postgres, service_role;

INSERT INTO public.sales_segment_map (sphere_code, segment) VALUES
    ('servisnyi-tsentr', 'Сервисный центр техники'),
    ('diler-proizvoditelei-selskokhoziaistvennoi-tekhniki-1', 'Сервисный центр техники'),
    ('prodazha-selskokhoziaistvennoi-tekhniki', 'Сервисный центр техники'),
    ('kompleksnoe-osnashchenie-avto', 'Сервисный центр техники'),
    ('remontnye-uslugi', 'Сервисный центр техники'),

    ('tekhnologicheskoe-proizvodstvo', 'Производство'),
    ('obrabatyvaiushchee-proizvodstvo', 'Производство'),
    ('pishevoe-proizvodstvo', 'Производство'),
    ('dorozhnye-predpriiatiia-1', 'Производство'),
    ('elektroseti', 'Производство'),
    ('aeroport', 'Производство'),

    ('detsad-obrazovatelnye-uchrezhdeniia', 'Детский сад'),
    ('osnashchenie-shkol-detskikh-sadov-sport-kompleksov-1', 'Школа, спорткомплекс'),
    ('sportivnyi-kompleks-fitnesklub-1', 'Школа, спорткомплекс'),
    ('gornolyzhnyi-kompleks', 'Школа, спорткомплекс'),

    ('nauchnye-issledovaniia-i-razrabotki', 'Лаборатория')
ON CONFLICT (sphere_code) DO UPDATE SET segment = EXCLUDED.segment, updated_at = now();

COMMENT ON TABLE public.sales_segment_map IS
    'Сфера деятельности из RetailCRM → сегмент карты решений. Перекупщики и торгующие организации сегмента не получают намеренно: у них задача не своя, а их заказчика, и угадывать её нельзя.';

-- Досье должно отдавать код сферы: по нему определяется сегмент.
DROP FUNCTION IF EXISTS public.sales_client_dossier(text);
CREATE OR REPLACE FUNCTION public.sales_client_dossier(p_client_key text)
RETURNS TABLE (
    client_name text, sphere_name text, sphere_code text,
    orders_count bigint, total_amount numeric, first_order timestamptz, last_order timestamptz,
    by_year jsonb, by_category jsonb, recent_orders jsonb,
    manager_comments text[], call_transcripts text[]
)
LANGUAGE sql STABLE AS $function$
    WITH mine AS (
        SELECT * FROM public.sales_client_purchases_mv WHERE client_key = p_client_key
    ),
    per_order AS (
        SELECT order_id, max(number) number, max(created_at) created_at, max(amount) amount
          FROM mine GROUP BY order_id
    )
    SELECT
        (SELECT max(client_name) FROM mine),
        (SELECT coalesce(d.item_name, m.sphere_code, 'сфера не указана')
           FROM mine m LEFT JOIN public.retailcrm_dictionaries d
                    ON d.dictionary_code = 'sfera_deiatelnosti' AND d.item_code = m.sphere_code
          LIMIT 1),
        (SELECT m.sphere_code FROM mine m WHERE m.sphere_code IS NOT NULL LIMIT 1),
        (SELECT count(*) FROM per_order),
        (SELECT sum(amount) FROM per_order),
        (SELECT min(created_at) FROM per_order),
        (SELECT max(created_at) FROM per_order),
        (SELECT jsonb_object_agg(y, s) FROM (
            SELECT to_char(created_at, 'YYYY') y, round(sum(amount)) s FROM per_order GROUP BY y
        ) t),
        (SELECT jsonb_object_agg(category, cnt) FROM (
            SELECT category, count(DISTINCT order_id) cnt FROM mine GROUP BY category
        ) t),
        (SELECT jsonb_agg(x) FROM (
            SELECT number, to_char(created_at, 'YYYY-MM-DD') AS date, round(amount) AS amount
              FROM per_order ORDER BY created_at DESC LIMIT 5
        ) x),
        (SELECT array_agg(txt) FROM (
            SELECT left(h.new_value::text, 400) txt
              FROM public.order_history_log h
             WHERE h.field = 'manager_comment'
               AND h.retailcrm_order_id IN (SELECT order_id FROM per_order)
               AND h.new_value IS NOT NULL
             ORDER BY h.occurred_at DESC LIMIT 5
        ) c),
        (SELECT array_agg(txt) FROM (
            SELECT left(r.transcript, 2500) txt
              FROM public.call_order_matches m
              JOIN public.raw_telphin_calls r ON r.telphin_call_id = m.telphin_call_id
             WHERE m.retailcrm_order_id IN (SELECT order_id FROM per_order)
               AND r.transcript IS NOT NULL AND length(r.transcript) > 200
             ORDER BY r.started_at DESC LIMIT 3
        ) t);
$function$;

GRANT EXECUTE ON FUNCTION public.sales_client_dossier(text) TO service_role;
