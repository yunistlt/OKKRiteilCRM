-- ============================================================================
-- Фильтр «Кол-во шт»: найти заказы, где товар идёт нужным количеством.
--
-- Просьба Лены Парфёновой 05.11.2026 (доработка 80): рядом с «Наименованием
-- товара» в фильтре заказов нужна ячейка количества. Сейчас по названию
-- находятся все заказы с этим изделием — и на одну штуку, и на пятьдесят, —
-- и нужный приходится искать глазами.
--
-- Количество лежит в позициях (order_items.quantity), а не в самом заказе,
-- поэтому отбор делает база и отдаёт номера заказов — тем же способом, что
-- поиск по словам (orders_search_ranked): список order_id уходит в общий
-- фильтр списка и в счётчики статусов, и цифры не расходятся со строками.
--
-- Состав заказа есть у 27 479 заказов из 38 806 — ровно у тех же, у кого
-- заполнен orders.items_text. То есть фильтр по количеству охватывает те же
-- заказы, что и нынешний фильтр по названию: ничего не теряется.
-- ============================================================================

-- Количество без индекса — последовательный проход по 60 тыс. позиций на
-- каждый запрос фильтра. Таблица небольшая, индекс строится мгновенно.
CREATE INDEX IF NOT EXISTS order_items_quantity_idx
    ON public.order_items (quantity);

CREATE OR REPLACE FUNCTION public.orders_item_qty_ids(
    qty numeric,
    q text DEFAULT NULL,
    max_rows int DEFAULT 500
)
RETURNS TABLE (order_id bigint)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
    -- Название как в фильтре по товару: знаки препинания не важны, «ШС-8» и
    -- «шс 8» — одно и то же (lib/orders-filter.ts, itemNamePattern).
    pattern text := CASE
        WHEN coalesce(btrim(q), '') = '' THEN NULL
        ELSE '%' || regexp_replace(lower(btrim(q)), '[^a-zа-яё0-9]+', '%', 'g') || '%'
    END;
BEGIN
    RETURN QUERY
    SELECT DISTINCT i.order_id
    FROM public.order_items i
    WHERE i.quantity = qty
      AND (
          pattern IS NULL
          OR lower(coalesce(i.offer->>'displayName', i.offer->>'name', '')) LIKE pattern
      )
    ORDER BY i.order_id DESC
    LIMIT max_rows;
END;
$function$;

COMMENT ON FUNCTION public.orders_item_qty_ids(numeric, text, int) IS
    'Заказы, где есть позиция с таким количеством (и, если задано, с таким названием). Доработка 80.';
