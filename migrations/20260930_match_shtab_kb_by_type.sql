-- Поиск по знаниям Тамары с отбором по виду статьи.
--
-- Зачем понадобился. Снимок схемы завода лежит в тех же знаниях, что и
-- управленческие методички, а в контекст едут всего четыре статьи. Замер
-- 30.09.2026 на живом вопросе «чего не хватает на заказы недели»: первые
-- четыре места заняли «Срок прохождения заказа», «Очереди и незавершёнка»,
-- «Как найти узкое место» и «Как замерить пропускную способность», а таблицы
-- ЦехУспеха оказались шестыми и седьмыми — то есть до модели не доехали вовсе,
-- и она пошла выяснять колонки запросами, как и раньше.
--
-- Соревноваться им незачем: это разные вещи. Вопрос про нехватку по заказам по
-- смыслу ближе к рассуждению об узких местах, чем к списку колонок, — и так
-- будет всегда. Поэтому схема ищется отдельно и своей квотой, а не отнимает
-- места у знаний.
--
-- Старая функция остаётся как была: её зовут из других мест, и менять её
-- сигнатуру ради одного случая — ломать то, что работает.
CREATE OR REPLACE FUNCTION public.match_shtab_kb_by_type(
    query_embedding vector(1536),
    match_threshold float,
    match_count int,
    want_types text[],
    exclude_types text[] DEFAULT '{}'
)
RETURNS TABLE (
    slug       text,
    type       text,
    title      text,
    content    text,
    source_ref text,
    similarity float
)
LANGUAGE sql
STABLE
AS $function$
    SELECT k.slug, k.type, k.title, k.content, k.source_ref,
           1 - (k.embedding <=> query_embedding) AS similarity
      FROM public.shtab_kb k
     WHERE k.is_active
       AND k.embedding IS NOT NULL
       AND 1 - (k.embedding <=> query_embedding) > match_threshold
       AND (cardinality(want_types) = 0 OR k.type = ANY(want_types))
       AND NOT (k.type = ANY(exclude_types))
     ORDER BY k.embedding <=> query_embedding
     LIMIT match_count;
$function$;

COMMENT ON FUNCTION public.match_shtab_kb_by_type(vector, float, int, text[], text[]) IS
    'Поиск по знаниям Тамары косинусной близостью с отбором по виду статьи. Пустой want_types — без ограничения.';
