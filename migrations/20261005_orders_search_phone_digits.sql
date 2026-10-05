-- Поиск по телефону в любом написании: счётчики слева должны совпадать
-- с таблицей (замечание Елены Парфёновой 05.10.2026).

CREATE OR REPLACE FUNCTION public.orders_filter_totals(p jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(orders_count bigint, total_sum numeric)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT COUNT(*)::bigint, COALESCE(SUM(o.totalsumm), 0)::numeric
      FROM public.orders o
     WHERE o.crm_deleted_at IS NULL
       AND o.status IS NOT NULL
       -- Номер заказа
       AND (COALESCE(p->>'number','') = '' OR o.number ILIKE '%' || (p->>'number') || '%')
       -- Покупатель: имя, фамилия, почта или телефон
       AND (COALESCE(p->>'customer','') = '' OR (
             COALESCE(o.raw_payload->>'firstName','') ILIKE '%' || (p->>'customer') || '%'
          OR COALESCE(o.raw_payload->>'lastName','')  ILIKE '%' || (p->>'customer') || '%'
          OR COALESCE(o.raw_payload->>'email','')     ILIKE '%' || (p->>'customer') || '%'
          OR COALESCE(o.phone,'')                     ILIKE '%' || (p->>'customer') || '%'
          -- Телефон как его набрал человек: «8 995 344-68-62» против «79953446862»
          -- в базе. Сравниваем по последним десяти цифрам.
          OR (length(regexp_replace(p->>'customer', '\D', '', 'g')) >= 10
              AND regexp_replace(COALESCE(o.phone,''), '\D', '', 'g')
                  ILIKE '%' || right(regexp_replace(p->>'customer', '\D', '', 'g'), 10) || '%')))
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
$function$
;

CREATE OR REPLACE FUNCTION public.orders_status_counts(p jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(status text, orders_count bigint)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT o.status, COUNT(*)::bigint
      FROM public.orders o
     WHERE o.crm_deleted_at IS NULL
       AND o.status IS NOT NULL
       -- Номер заказа
       AND (COALESCE(p->>'number','') = '' OR o.number ILIKE '%' || (p->>'number') || '%')
       -- Покупатель: имя, фамилия, почта или телефон
       AND (COALESCE(p->>'customer','') = '' OR (
             COALESCE(o.raw_payload->>'firstName','') ILIKE '%' || (p->>'customer') || '%'
          OR COALESCE(o.raw_payload->>'lastName','')  ILIKE '%' || (p->>'customer') || '%'
          OR COALESCE(o.raw_payload->>'email','')     ILIKE '%' || (p->>'customer') || '%'
          OR COALESCE(o.phone,'')                     ILIKE '%' || (p->>'customer') || '%'
          -- Телефон как его набрал человек: «8 995 344-68-62» против «79953446862»
          -- в базе. Сравниваем по последним десяти цифрам.
          OR (length(regexp_replace(p->>'customer', '\D', '', 'g')) >= 10
              AND regexp_replace(COALESCE(o.phone,''), '\D', '', 'g')
                  ILIKE '%' || right(regexp_replace(p->>'customer', '\D', '', 'g'), 10) || '%')))
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
       -- Только просроченные: норматив свой у каждого статуса, приходит списком
       AND (NOT COALESCE((p->>'overdueOnly')::boolean, false) OR (
             o.status_since IS NOT NULL
             AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(COALESCE(p->'norms','[]'::jsonb)) n
                  WHERE n->>'status' = o.status
                    AND o.status_since < NOW() - ((n->>'normDays')::int * INTERVAL '1 day')
             )))
     GROUP BY o.status
$function$
;

