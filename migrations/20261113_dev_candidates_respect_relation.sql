-- Задачи на развитие уважают договорённость с клиентом.
--
-- Доработки №86–№90 (Ирина Гордеева, 10.11.2026): «звонок совершён, нет
-- потребности — уберите задачу», «дата переставлена на завтра, задача не
-- уходит», «есть заказ в работе, звонить незачем».
--
-- Причина: утренний план берёт клиентов на развитие функцией
-- `sales_dev_candidates`, а она знает про клиента ровно одно — когда он
-- покупал в последний раз. Снимок отношений (`sales_client_relation`) с
-- ритмом касаний, отметкой «не беспокоить» и назначенной датой следующего
-- контакта строился рядом и в отбор не входил вовсе. Проверка 11.11.2026:
-- в плане у Ирины стояли ООО «КВАДРО» (дата следующего контакта 31.12.2026,
-- живая заявка) и ЗАО «Таманьнефтегаз» (14.12.2026) — оба «пора звонить».
--
-- Теперь клиент в развитие не попадает, если:
--   * он отключён вручную («нет потребности» — `muted`);
--   * ритм или человек назначили следующий контакт на будущее;
--   * в его последнем заказе стоит дата следующего контакта в будущем —
--     обещание клиенту, его автоматика не трогает (закон 01.09.2026).
--
-- Ключ клиента пишется по-разному: в снимке отношений это ИНН либо
-- «cust:<id карточки>», в профиле покупок — ИНН либо «cid:<id карточки>».
-- Это один и тот же клиент, поэтому сверяем оба написания.

CREATE OR REPLACE FUNCTION public.sales_dev_candidates(
    p_min_orders integer DEFAULT 2,
    p_min_days_since integer DEFAULT 30,
    p_max_days_since integer DEFAULT 540
)
 RETURNS TABLE(client_key text, client_name text, sphere_name text, manager_id bigint,
               orders_count bigint, total_amount numeric, days_since integer,
               own_categories text[], suggest_categories text[],
               last_order_id bigint, last_order_number text)
 LANGUAGE sql
 STABLE
AS $function$
    WITH candidate AS (
        SELECT c.client_key, c.client_name, c.sphere_code, c.manager_id,
               c.orders_count, c.total_amount, c.last_order_at, c.own_categories,
               (SELECT p.order_id FROM public.sales_client_purchases_mv p
                 WHERE p.client_key = c.client_key ORDER BY p.created_at DESC LIMIT 1) AS last_order_id,
               (SELECT p.number::text FROM public.sales_client_purchases_mv p
                 WHERE p.client_key = c.client_key ORDER BY p.created_at DESC LIMIT 1) AS last_order_number
          FROM public.sales_client_profile_mv c
         WHERE c.orders_count >= p_min_orders
           AND EXTRACT(DAY FROM now() - c.last_order_at) BETWEEN p_min_days_since AND p_max_days_since
    )
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
           c.last_order_id,
           c.last_order_number
      FROM candidate c
      LEFT JOIN public.retailcrm_dictionaries d
             ON d.dictionary_code = 'sfera_deiatelnosti' AND d.item_code = c.sphere_code
      LEFT JOIN public.sales_client_relation r
             ON r.client_key = c.client_key
             OR r.client_key = replace(c.client_key, 'cid:', 'cust:')
      LEFT JOIN public.orders o ON o.order_id = c.last_order_id
     WHERE coalesce(r.muted, false) = false
       AND coalesce(r.next_contact_at, current_date) <= current_date
       AND coalesce(
               nullif(o.raw_payload->'customFields'->>'data_kontakta', ''),
               '0001-01-01'
           ) <= current_date::text;
$function$;
