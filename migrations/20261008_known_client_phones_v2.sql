-- ============================================================================
-- Сверка номеров расширяется телефонами ЗАКАЗОВ.
--
-- Владелец 08.10.2026 показал звонок на +7 927 523-21-59: номер в системе есть,
-- но лежит в заказе 900096, а в карточку клиента не попал — кнопки «Позвонить»
-- не было, и это выглядело ошибкой.
--
-- Телефон в заказе вписал человек, а не телефония: это такой же проверенный
-- номер клиента, как и в карточке. Автоответчики и переадресации из реестра
-- звонков сюда по-прежнему не попадают — в заказах их нет.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.known_client_phones(p_tails text[])
 RETURNS TABLE(tail text, client_id bigint, source text)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT DISTINCT ON (t.tail)
           t.tail,
           c.id AS client_id,
           'company'::text AS source
      FROM unnest(p_tails) AS t(tail)
      JOIN public.clients c ON TRUE
      JOIN LATERAL unnest(coalesce(c.phones, ARRAY[]::text[])) AS p(phone) ON TRUE
     WHERE right(regexp_replace(p.phone, '\D', '', 'g'), 10) = t.tail

    UNION ALL

    SELECT DISTINCT ON (t.tail)
           t.tail,
           cu.id AS client_id,
           'contact'::text AS source
      FROM unnest(p_tails) AS t(tail)
      JOIN public.customers cu ON TRUE
      JOIN LATERAL unnest(coalesce(cu.phones, ARRAY[]::text[])) AS p(phone) ON TRUE
     WHERE right(regexp_replace(p.phone, '\D', '', 'g'), 10) = t.tail

    UNION ALL

    -- Телефон из заказа: карточку он не заменяет, но номер проверенный.
    -- Клиента берём того, на кого оформлен заказ.
    SELECT tail, client_id, source FROM (
        SELECT DISTINCT ON (t.tail)
               t.tail AS tail,
               -- Карточки может не быть (свой заказ без привязки) — тогда
               -- кнопка «Позвонить» есть, а ссылки на карточку нет.
               CASE WHEN o.customer->>'id' ~ '^[0-9]+$' THEN (o.customer->>'id')::bigint END AS client_id,
               'order'::text AS source,
               o.created_at
          FROM unnest(p_tails) AS t(tail)
          JOIN public.orders o
            ON right(regexp_replace(coalesce(o.phone, ''), '\D', '', 'g'), 10) = t.tail
            OR right(regexp_replace(coalesce(o."additionalPhone", ''), '\D', '', 'g'), 10) = t.tail
         WHERE o.crm_deleted_at IS NULL
         ORDER BY t.tail, o.created_at DESC
    ) AS from_orders;
$function$;

-- Сверка по заказам без индексов шла 7,5 с на страницу реестра — для списка,
-- который открывают десятки раз в день, это много. Индексы по тем же
-- выражениям, что в условии.
CREATE INDEX IF NOT EXISTS orders_phone_tail_idx
    ON public.orders ((right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)));
CREATE INDEX IF NOT EXISTS orders_additional_phone_tail_idx
    ON public.orders ((right(regexp_replace(coalesce("additionalPhone", ''), '\D', '', 'g'), 10)));
