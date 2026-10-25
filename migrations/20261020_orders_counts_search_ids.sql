-- ============================================================================
-- Счётчики статусов и «Итого» считают по тому же поиску, что и список.
--
-- Поиск по заказам стал ранжированным (orders_search_ranked, 20.10.2026):
-- слова ищутся по отдельности, порядок не важен, сверху — самое полное
-- совпадение. Список берёт из него номера заказов, и счётчики должны считать
-- ровно по этим же номерам, иначе цифры в колонке статусов разойдутся с
-- показанными строками.
--
-- Поэтому вместо условия по тексту (`items_text ILIKE …`) функции принимают
-- готовый список номеров — `searchIds`. Старое условие оставлено для вызовов,
-- которые список не передают.
-- ============================================================================

DO $$
DECLARE
    fn text;
    body text;
    old_condition text := '       AND (COALESCE(p->>''itemName'','''') = '''' OR COALESCE(o.items_text,'''') ILIKE ''%'' || (p->>''itemName'') || ''%'')';
    new_condition text :=
        '       -- Поиск по словам: номера заказов уже посчитаны (orders_search_ranked).' || E'\n' ||
        '       AND (jsonb_array_length(COALESCE(p->''searchIds'',''[]''::jsonb)) = 0' || E'\n' ||
        '            OR o.order_id::text IN (SELECT jsonb_array_elements_text(p->''searchIds'')))' || E'\n' ||
        '       AND (COALESCE(p->>''itemName'','''') = '''' OR jsonb_array_length(COALESCE(p->''searchIds'',''[]''::jsonb)) > 0' || E'\n' ||
        '            OR COALESCE(o.items_text,'''') ILIKE ''%'' || (p->>''itemName'') || ''%'')';
BEGIN
    FOR fn IN SELECT unnest(ARRAY['orders_status_counts', 'orders_filter_totals']) LOOP
        SELECT pg_get_functiondef(oid) INTO body FROM pg_proc WHERE proname = fn LIMIT 1;
        IF body IS NULL THEN
            RAISE EXCEPTION 'Функция % не найдена', fn;
        END IF;
        IF position(old_condition in body) = 0 THEN
            RAISE NOTICE 'Функция % уже обновлена или изменилась — пропускаем', fn;
            CONTINUE;
        END IF;
        EXECUTE replace(body, old_condition, new_condition);
        RAISE NOTICE 'Функция % обновлена', fn;
    END LOOP;
END $$;
