-- Перенос уцелевшей истории из замороженной raw_order_events в order_history_log.
--
-- ЗАЧЕМ. raw_order_events — старый сырой слой истории заказов, который наполнял
-- отключённый синк /api/sync/history. Последняя запись — 11 апреля 2026, в коде
-- она помечена «заморожена, читать нельзя» (lib/order-events.ts). Весь код давно
-- работает с order_history_log. При этом таблица занимает 672 МБ — шестую часть
-- базы, которая не помещается в память и вытесняет рабочие таблицы.
--
-- ЧТО В НЕЙ ОСТАЛОСЬ ЦЕННОГО (замер 16.10.2026, всего 379 025 записей):
--   250 982  уже есть в order_history_log — дубликаты, переносить нечего
--   102 617  полные записи, которых в новой таблице НЕТ — переносим здесь
--    52 167  упрощённые записи старого формата: без номера записи CRM и без
--            «было», только «стало». Корректно перевести их нельзя: в новой
--            таблице номер записи обязателен и уникален, а выдуманный номер
--            столкнулся бы с настоящим. Эти остаются непереносимыми.
--
-- ЧТО ПЕРЕНОСИМ. Только полные записи — у них внутри лежит исходная запись
-- истории RetailCRM: номер, поле, «было», «стало», время. Период 01.01.2024 —
-- 31.03.2026, 6 857 заказов.
--
-- НАЗВАНИЯ ПОЛЕЙ. В старой таблице тип события и поле внутри записи почти везде
-- совпадают, но в трёх случаях расходятся — берём то, что внутри записи, как
-- более точное, а при его отсутствии приводим тип события к новому имени:
--   manager_changed → manager        (1 928)
--   product_changed → order_product  (1 503)
--   order_created   → поля внутри нет вовсе (587): это факт создания заказа,
--                     в новой схеме такого поля нет — записываем как 'created'.
--
-- БЕЗОПАСНОСТЬ. Переносим только то, чего в новой таблице нет (сверка по номеру
-- записи CRM). Повторный запуск ничего не продублирует. Старую таблицу НЕ
-- трогаем: решение об её удалении принимается отдельно, после проверки.

INSERT INTO public.order_history_log
    (retailcrm_history_id, retailcrm_order_id, field, old_value, new_value, user_data, occurred_at, created_at)
SELECT
    (e.raw_payload->>'id')::integer,
    e.retailcrm_order_id,
    COALESCE(
        NULLIF(e.raw_payload->>'field', ''),
        CASE e.event_type
            WHEN 'manager_changed' THEN 'manager'
            WHEN 'product_changed' THEN 'order_product'
            WHEN 'order_created'   THEN 'created'
            ELSE e.event_type
        END
    ),
    -- «Было» и «стало» хранятся как JSON: у справочников это объект
    -- {"code":...,"name":...}, у текста и чисел — само значение. В новой
    -- таблице поля текстовые, и там лежит ровно то же самое в том же виде.
    CASE WHEN jsonb_typeof(e.raw_payload->'oldValue') = 'string'
         THEN e.raw_payload->>'oldValue'
         ELSE NULLIF((e.raw_payload->'oldValue')::text, 'null') END,
    CASE WHEN jsonb_typeof(e.raw_payload->'newValue') = 'string'
         THEN e.raw_payload->>'newValue'
         ELSE NULLIF((e.raw_payload->'newValue')::text, 'null') END,
    -- Кто изменил: в старой схеме это отдельная колонка, в новой — объект,
    -- тот же вид, что у записей синхронизации RetailCRM.
    CASE WHEN e.manager_id IS NOT NULL
         THEN jsonb_build_object('id', e.manager_id)
         ELSE NULL END,
    e.occurred_at,
    e.ingested_at
FROM public.raw_order_events e
WHERE e.raw_payload ? 'id'
  AND NOT EXISTS (
      SELECT 1 FROM public.order_history_log h
       WHERE h.retailcrm_history_id = (e.raw_payload->>'id')::integer
  );

ANALYZE public.order_history_log;

-- ============================================================================
-- ВЫПОЛНЕНО 16.10.2026. После переноса и проверки таблица удалена:
--
--   DROP FUNCTION public.match_calls_to_orders(integer);  -- мёртвая, ничем не вызывалась
--   DROP TABLE public.raw_order_events;                   -- 672 МБ, за 219 мс
--
-- Сверка перед удалением: в боевом коде (lib/, app/) обращений не было, только
-- комментарии-пометки «заморожена». Скрипт проверки качества Семёна
-- (okk_consultant_real_cases.ts) переведён на order_history_log. Два
-- одноразовых скрипта помечены «не запускать»: run_hybrid_matching.ts искал
-- заказы по телефону, которого в живой истории нет вовсе, а
-- backfill-history-from-raw-events.mjs делал ровно то, что сделала эта миграция.
-- Внешних ключей, представлений и триггеров на таблице не было.
--
-- База: 3 486 МБ → 2 814 МБ.
-- ============================================================================
