-- ============================================================================
-- Поиск заказов по клиенту: по карточке и по телефону в любой записи.
--
-- Жалобы менеджеров 06.10.2026. Евгения Матвеева: «не ищет клиентов по имени,
-- фамилии, номеру телефона — иногда клиент не помнит номер заказа, и его
-- невозможно найти». Ирина Гордеева: ввела номер телефона — «под этот фильтр
-- заказов нет», хотя заказ с этим номером есть.
--
-- Две причины. Первая: фильтр искал только внутри заказа, где записан контакт,
-- а карточку клиента не смотрел. Вторая: телефон сравнивался как написан, а
-- пишут его все по-разному — «+7 (995) 344-68-62», «8 995…», слитно.
--
-- Здесь — поиск карточек по последним десяти цифрам номера: они не зависят от
-- записи. Ищем в обеих таблицах карточек: `clients` — наши, `customers` —
-- приехавшие из RetailCRM.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.client_ids_by_phone_tail(p_tail text, p_limit int DEFAULT 300)
 RETURNS TABLE(client_id bigint)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT id FROM (
        SELECT c.id
          FROM public.clients c
         WHERE EXISTS (
               SELECT 1 FROM unnest(COALESCE(c.phones, ARRAY[]::text[])) ph
                WHERE regexp_replace(ph, '\D', '', 'g') LIKE '%' || p_tail
           )
        UNION
        SELECT k.id
          FROM public.customers k
         WHERE EXISTS (
               SELECT 1 FROM unnest(COALESCE(k.phones, ARRAY[]::text[])) ph
                WHERE regexp_replace(ph, '\D', '', 'g') LIKE '%' || p_tail
           )
    ) t
     LIMIT p_limit;
$function$;

COMMENT ON FUNCTION public.client_ids_by_phone_tail(text, int) IS
    'Карточки клиентов по последним цифрам телефона — запись номера у всех разная (жалобы менеджеров 06.10.2026).';
