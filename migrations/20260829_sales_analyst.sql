-- Второй слой бота-РОПа: анализ клиента моделью.
--
-- Разделение слоёв принципиальное, а не техническое:
--
--   Слой 1, код. Кого сегодня трогать, какие суммы, было ли касание. Это числа
--   и списки, они уходят в общий чат с тегом человека, и ошибка здесь — это
--   публичный упрёк за то, чего он не делал. Модели тут не место.
--
--   Слой 2, модель. О чём с клиентом говорить. Здесь нет ни одного числа,
--   которое можно испортить, зато есть то, чего код не умеет: прочитать
--   переписку и расшифровки звонков и понять, что у клиента происходит.
--
-- Модель получает готовое досье и список категорий, которые мы действительно
-- производим. Придумать товар она не может — его нет в списке, а промпт требует
-- опираться только на досье.

CREATE TABLE IF NOT EXISTS public.sales_client_insight (
    client_key   text PRIMARY KEY,
    client_name  text NOT NULL DEFAULT '',
    -- Что предложить и на что опереться в разговоре.
    opportunity  text NOT NULL DEFAULT '',
    talk_track   text NOT NULL DEFAULT '',
    -- Откуда это взято: цитата или факт из досье. Без основания рекомендация
    -- неотличима от фантазии, и менеджер не сможет её проверить.
    evidence     text NOT NULL DEFAULT '',
    -- Чего обещать нельзя: сроки, цены, наличие — модель их не знает.
    caution      text NOT NULL DEFAULT '',
    model        text NOT NULL DEFAULT '',
    -- Отпечаток досье: пока факты те же, платить за повторный разбор незачем.
    dossier_fingerprint text NOT NULL DEFAULT '',
    generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_client_insight_at ON public.sales_client_insight (generated_at);

ALTER TABLE public.sales_client_insight ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_client_insight_rw ON public.sales_client_insight;
CREATE POLICY sales_client_insight_rw ON public.sales_client_insight FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.sales_client_insight TO postgres, service_role;

-- Досье клиента: всё, что мы о нём знаем, одним запросом.
CREATE OR REPLACE FUNCTION public.sales_client_dossier(p_client_key text)
RETURNS TABLE (
    client_name text, sphere_name text,
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
        (SELECT count(*) FROM per_order),
        (SELECT sum(amount) FROM per_order),
        (SELECT min(created_at) FROM per_order),
        (SELECT max(created_at) FROM per_order),
        -- Динамика по годам: по ней видно, растёт клиент или сдувается.
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
        -- Комментарии менеджера по заказам этого клиента: там живут договорённости.
        (SELECT array_agg(txt) FROM (
            SELECT left(h.new_value::text, 400) txt
              FROM public.order_history_log h
             WHERE h.field = 'manager_comment'
               AND h.retailcrm_order_id IN (SELECT order_id FROM per_order)
               AND h.new_value IS NOT NULL
             ORDER BY h.occurred_at DESC LIMIT 5
        ) c),
        -- Расшифровки звонков: единственное место, где слышно самого клиента.
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

-- Промпт живёт в базе, как у остальных агентов: его правят без деплоя.
INSERT INTO public.ai_prompts (key, description, system_prompt, user_prompt_template, model, temperature, max_tokens, is_active)
VALUES (
    'sales_client_analyst',
    'Аналитик клиента для бота-РОПа: что предложить и о чём говорить',
    'Ты аналитик отдела продаж завода металлоконструкций ЗМК (Тольятти). Тебе дают досье клиента: что он покупал, как менялись объёмы, комментарии менеджеров и расшифровки звонков.

Твоя задача — сказать менеджеру, что этому клиенту предложить дополнительно и с чего начать разговор.

Жёсткие правила:
1. Опирайся ТОЛЬКО на досье. Ничего не додумывай про клиента.
2. Предлагать можно только категории из списка «Что мы производим». Товара, которого там нет, у нас не существует.
3. Не называй сроки, цены, скидки и наличие — ты их не знаешь, а менеджер повторит клиенту.
4. В поле evidence приведи конкретный факт или цитату из досье, на которых стоит твой вывод. Без основания рекомендация неотличима от выдумки.
5. Если досье бедное и сказать нечего — так и напиши в opportunity: «данных мало, начать с вопроса о планах». Выдумывать повод хуже, чем признать, что его нет.
6. Пиши по-русски, коротко, как говорят между собой продавцы. Без канцелярита и без пафоса.

Отвечай строго в JSON:
{"opportunity": "что предложить, 1-2 предложения", "talk_track": "с чего начать разговор, 1-2 предложения", "evidence": "факт из досье", "caution": "чего не обещать или на что обратить внимание, коротко"}',
    '{{dossier}}',
    'gpt-4o-mini',
    0.4,
    600,
    true
)
ON CONFLICT (key) DO NOTHING;
