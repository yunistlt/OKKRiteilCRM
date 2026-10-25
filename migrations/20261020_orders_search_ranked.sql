-- ============================================================================
-- Поиск заказа: прямое вхождение знаков, порядок слов не важен,
-- самое полное совпадение — сверху.
--
-- Правило владельца 20.10.2026: «поиск должен осуществляться по прямому
-- вхождению знаков, без учёта регистра, знаков препинания; сверху показываться
-- с максимальным вхождением в условия поиска».
--
-- Повод — жалоба Ирины Гордеевой 20.10.2026: «поиск не ищет по обозначению,
-- что стеллаж именно на 12 пар нужен, а он есть у нас». Товар в базе
-- называется «Сушильный стеллаж для обуви "SL1 Вираж — Эконом". Односторонний
-- На 12 пар обуви»: искомые слова в нём есть, но идут в другом порядке и
-- разделены знаками препинания, а поиск требовал их подряд.
--
-- Что делает функция: разбирает запрос на слова, ищет каждое слово в строке
-- покупателя (search_text) и в составе заказа (items_text) и считает, сколько
-- слов нашлось. Заказы, где нашлись все слова, идут выше; вхождение всей фразы
-- целиком ценится ещё выше.
--
-- Оба поля под gin_trgm индексами (orders_search_text_trgm,
-- orders_items_text_trgm), поэтому каждое слово ищется по индексу.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.orders_search_ranked(q text, max_rows int DEFAULT 2000)
RETURNS TABLE (order_id bigint, rank int)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
    -- Запрос без знаков препинания и регистра: «СТ-15» и «ст 15» — одно и то же.
    normalized text := btrim(regexp_replace(lower(coalesce(q, '')), '[^a-zа-яё0-9]+', ' ', 'g'));
    words text[];
    -- Самое длинное слово запроса: им отбираем кандидатов на неполное совпадение.
    anchor text;
    /**
     * Сколько заказов с НЕПОЛНЫМ совпадением разбираем.
     *
     * Заказы, где нашлись все слова, отбираются запросом по индексу и стоят
     * сверху — их считать дёшево (92 мс на боевой базе). Неполные совпадения
     * считаются перебором, а одно слово вроде «стеллаж» поднимает 6 088
     * заказов: разобрать их все — почти три секунды, а у базы слабый диск и
     * тяжёлый запрос в рабочее время останавливает отдел (закон владельца
     * 16.10.2026). Поэтому хвост ограничен: человеку нужны верхние строки, а
     * не весь перебор.
     */
    partial_limit int := 500;
BEGIN
    IF normalized = '' THEN
        RETURN;
    END IF;

    words := regexp_split_to_array(normalized, ' ');
    SELECT w INTO anchor FROM unnest(words) AS w ORDER BY length(w) DESC LIMIT 1;

    RETURN QUERY
    WITH
    /**
     * Нашлись ВСЕ слова — самое полное совпадение. Порядок слов не важен:
     * каждое слово ищется само по себе, по gin_trgm индексу.
     */
    full_match AS (
        SELECT o.order_id,
               /**
                * Слова идут подряд — это точное попадание, оно выше прочих.
                * Сравниваем по тексту без знаков препинания: «Вираж-Стандарт»
                * и «вираж стандарт» — одно и то же. Приведение к такому виду
                * дорогое, поэтому делаем его только здесь, на строках, где уже
                * нашлись все слова.
                */
               (CASE WHEN position(normalized in regexp_replace(
                        lower(coalesce(o.search_text, '') || ' ' || coalesce(o.items_text, '')),
                        '[^a-zа-яё0-9]+', ' ', 'g')) > 0
                     THEN 1100 ELSE 1000 END) AS rank
        FROM public.orders o
        WHERE NOT EXISTS (
            SELECT 1 FROM unnest(words) AS w
            WHERE coalesce(o.search_text, '') NOT ILIKE '%' || w || '%'
              AND coalesce(o.items_text, '') NOT ILIKE '%' || w || '%'
        )
          AND (coalesce(o.search_text, '') ILIKE '%' || anchor || '%'
               OR coalesce(o.items_text, '') ILIKE '%' || anchor || '%')
        LIMIT max_rows
    ),
    -- Нашлась часть слов: ниже полных совпадений, между собой — по числу слов.
    candidates AS (
        SELECT o.order_id, o.search_text, o.items_text
        FROM public.orders o
        WHERE (coalesce(o.search_text, '') ILIKE '%' || anchor || '%'
               OR coalesce(o.items_text, '') ILIKE '%' || anchor || '%')
          AND o.order_id NOT IN (SELECT f.order_id FROM full_match f)
        LIMIT partial_limit
    ),
    partial_match AS (
        SELECT c.order_id, m.matched * 10 AS rank
        FROM candidates c
        CROSS JOIN LATERAL (
            SELECT count(*)::int AS matched
            FROM unnest(words) AS w
            WHERE coalesce(c.search_text, '') ILIKE '%' || w || '%'
               OR coalesce(c.items_text, '') ILIKE '%' || w || '%'
        ) m
        /**
         * Половина слов — порог. Заказ, где нашлось одно слово из четырёх, —
         * это не ответ на запрос, а шум: по «стеллаж на 12 пар» такого
         * «найденного» набиралось восемь сотен, и человеку приходилось
         * выбирать нужное глазами.
         */
        WHERE m.matched * 2 >= array_length(words, 1)
    )
    SELECT m.order_id, m.rank::int
    FROM (
        SELECT f.order_id, f.rank FROM full_match f
        UNION ALL
        SELECT p.order_id, p.rank FROM partial_match p WHERE p.rank > 0
    ) m
    ORDER BY m.rank DESC, m.order_id DESC
    LIMIT max_rows;
END;
$function$;

COMMENT ON FUNCTION public.orders_search_ranked(text, int) IS
    'Поиск заказов по покупателю и составу: прямое вхождение знаков, без учёта регистра и пунктуации, порядок слов не важен. Ранг — число совпавших слов, вся фраза целиком даёт бонус.';
