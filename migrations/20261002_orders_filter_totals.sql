-- Итого по фильтру внизу списка заказов: сколько заказов и на какую сумму.
--
-- Считаем в базе, а не по выборке: Supabase отдаёт максимум 1000 строк, и
-- «итого» по странице врало бы так же, как врали счётчики статусов
-- (требование владельца 02.10.2026: «как в RetailCRM»).
--
-- ВАЖНО: условия ниже повторяют предикат функции orders_status_counts
-- (migrations/20261001_orders_status_counts.sql) и фильтр списка
-- (lib/orders-filter.ts). Меняешь фильтр — правишь все три места.
-- Отличие одно: здесь фильтр по статусу ПРИМЕНЯЕТСЯ — итог считается по тому,
-- что менеджер видит в таблице.

CREATE OR REPLACE FUNCTION public.orders_filter_totals(p JSONB DEFAULT '{}'::jsonb)
RETURNS TABLE (orders_count BIGINT, total_sum NUMERIC)
LANGUAGE sql
STABLE
AS $$
    SELECT COUNT(*)::bigint, COALESCE(SUM(o.totalsumm), 0)::numeric
      FROM public.orders o
     WHERE o.crm_deleted_at IS NULL
       AND o.status IS NOT NULL
       -- Номер заказа
       AND (COALESCE(p->>'number','') = '' OR o.number ILIKE '%' || (p->>'number') || '%')
       -- Покупатель: контакт заказа, его телефоны ИЛИ карточка клиента.
       -- Карточки подбирает код (clientIdsByText) и присылает списком: клиент
       -- может называться не так, как записан контакт заказа.
       AND (COALESCE(p->>'customer','') = '' OR (
          -- Одно поле вместо семи: по одному поиск 121 мс, через ИЛИ по семи —
          -- 2 061 мс (замер 07.10.2026). Поле собирает триггер.
             COALESCE(o.search_text,'') ILIKE '%' || lower(p->>'customer') || '%'
          -- Телефон сверяем и по последним десяти цифрам: записывают его
          -- по-разному, а поиск молча не находил ничего.
          OR (length(regexp_replace(p->>'customer', '\D', '', 'g')) >= 10 AND EXISTS (
                SELECT 1 FROM unnest(COALESCE(o.customer_phones, ARRAY[]::text[])) ph
                 WHERE regexp_replace(ph, '\D', '', 'g')
                       LIKE '%' || right(regexp_replace(p->>'customer', '\D', '', 'g'), 10)))
          OR (jsonb_array_length(COALESCE(p->'customerIds','[]'::jsonb)) > 0
              AND o.raw_payload->'customer'->>'id' IN (
                    SELECT jsonb_array_elements_text(p->'customerIds')))))
       -- Наименование товара: названия позиций лежат строкой в orders.items_text
       -- (просьба Евгении Матвеевой 06.10.2026 — искать дубли по изделию).
       -- Знаки препинания приходят уже подстановками, как и в списке.
       AND (COALESCE(p->>'itemName','') = '' OR COALESCE(o.items_text,'') ILIKE '%' || (p->>'itemName') || '%')
       -- Менеджеры
       AND (p->'managers' IS NULL OR jsonb_array_length(p->'managers') = 0
            OR o.manager_id::text IN (SELECT jsonb_array_elements_text(p->'managers')))
       -- Пометки
       AND (NOT COALESCE((p->>'vip')::boolean, false) OR o.raw_payload->'customer'->>'vip' = 'true')
       AND (NOT COALESCE((p->>'bad')::boolean, false) OR o.raw_payload->'customer'->>'bad' = 'true')
       -- Сумма заказа
       AND (COALESCE(p->>'sumFrom','') = '' OR o.totalsumm >= (p->>'sumFrom')::numeric)
       AND (COALESCE(p->>'sumTo','')   = '' OR o.totalsumm <= (p->>'sumTo')::numeric)
       -- Категория товара и сфера деятельности
       AND (p->'categories' IS NULL OR jsonb_array_length(p->'categories') = 0
            OR o.raw_payload->'customFields'->>'typ_castomer' IN (SELECT jsonb_array_elements_text(p->'categories')))
       AND (p->'sferas' IS NULL OR jsonb_array_length(p->'sferas') = 0
            OR o.raw_payload->'customFields'->>'sfera_deiatelnosti' IN (SELECT jsonb_array_elements_text(p->'sferas')))
       -- Контроль
       AND (COALESCE(p->>'control','') = ''
            OR (p->>'control' = 'yes' AND o.raw_payload->'customFields'->>'control' = 'true')
            OR (p->>'control' = 'no'  AND o.raw_payload->'customFields'->>'control' = 'false'))
       -- Даты приходят уже развёрнутыми: относительные смещения считает код.
       AND (COALESCE(p->>'contactFrom','') = '' OR o.raw_payload->'customFields'->>'data_kontakta' >= (p->>'contactFrom'))
       AND (COALESCE(p->>'contactTo','')   = '' OR o.raw_payload->'customFields'->>'data_kontakta' <= (p->>'contactTo'))
       AND (COALESCE(p->>'purchaseFrom','') = '' OR o.raw_payload->'customFields'->>'kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoialo_pole_dlia_daty' >= (p->>'purchaseFrom'))
       AND (COALESCE(p->>'purchaseTo','')   = '' OR o.raw_payload->'customFields'->>'kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoialo_pole_dlia_daty' <= (p->>'purchaseTo'))
       AND (COALESCE(p->>'createdFrom','') = '' OR o.created_at >= (p->>'createdFrom')::timestamptz)
       AND (COALESCE(p->>'createdTo','')   = '' OR o.created_at <= ((p->>'createdTo') || 'T23:59:59')::timestamptz)
       -- Контрагент и комментарии
       AND (COALESCE(p->>'contragent','') = '' OR COALESCE(o.raw_payload->'contragent'->>'legalName','') ILIKE '%' || (p->>'contragent') || '%')
       AND (COALESCE(p->>'managerComment','') = '' OR COALESCE(o.raw_payload->>'managerComment','') ILIKE '%' || (p->>'managerComment') || '%')
       AND (COALESCE(p->>'customerComment','') = '' OR COALESCE(o.raw_payload->>'customerComment','') ILIKE '%' || (p->>'customerComment') || '%')
       -- Только возможные дубли: кандидатов считает orders_duplicate_ids,
       -- маршрут списка присылает их номерами — одно условие на список и на
       -- счётчики, иначе цифры разойдутся со строками.
       AND (NOT COALESCE((p->>'duplicatesOnly')::boolean, false) OR
            o.order_id::text IN (SELECT jsonb_array_elements_text(COALESCE(p->'duplicateIds','[]'::jsonb))))
       -- Только просроченные: норматив свой у каждого статуса, приходит списком
       AND (NOT COALESCE((p->>'overdueOnly')::boolean, false) OR (
             o.status_since IS NOT NULL
             AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(COALESCE(p->'norms','[]'::jsonb)) n
                  WHERE n->>'status' = o.status
                    AND o.status_since < NOW() - ((n->>'normDays')::int * INTERVAL '1 day')
             )))
       -- Выбранные статусы: итог считается по видимой таблице
       AND (p->'statuses' IS NULL OR jsonb_array_length(p->'statuses') = 0
            OR o.status IN (SELECT jsonb_array_elements_text(p->'statuses')))
$$;

COMMENT ON FUNCTION public.orders_filter_totals(JSONB) IS
  'Итого по фильтру списка заказов: количество и сумма, без ограничения в 1000 строк';
