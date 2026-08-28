-- Логика ЦехУспеха для Тамары: тела хранимых функций, структура таблиц и формы
-- Delphi, разложенные для поиска по смыслу.
--
-- Зачем отдельная таблица, а не shtab_kb. Там управленческие знания — методичка
-- «Альянс Стратег» и канон; смешивать с ними чужой код нельзя: поиск по вопросу
-- «как считается прибыль» вытаскивал бы вперемешку методичку и Delphi, и Тамара
-- ссылалась бы на код там, где нужен подход, и наоборот. Устройство при этом
-- то же самое — тот же размер вектора, тот же индекс, тот же приём с отпечатком.
--
-- Почему это вообще лежит у нас. Тела функций read-only учётке MySQL не видны:
-- information_schema отдаёт 53 функции и ноль тел. Источник — локальный дамп
-- схемы и папка исходников, до которых прод не дотягивается.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.shtab_tseh_code (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       text NOT NULL UNIQUE,
    -- function — тело хранимой функции или процедуры MySQL;
    -- table    — структура таблицы: колонки и типы, без данных;
    -- unit     — кусок формы Delphi.
    kind       text NOT NULL CHECK (kind IN ('function', 'table', 'unit')),
    name       text NOT NULL,
    title      text NOT NULL,
    content    text NOT NULL,
    -- путь к оригиналу: любую строку ответа Тамары можно проверить по исходнику,
    -- а не принимать на веру. Для чужого кода это обязательное условие.
    source_ref text NOT NULL DEFAULT '',
    is_active  boolean NOT NULL DEFAULT true,
    embedding  vector(1536),
    fingerprint text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shtab_tseh_code_active ON public.shtab_tseh_code (is_active, kind);
CREATE INDEX IF NOT EXISTS idx_shtab_tseh_code_name ON public.shtab_tseh_code (name);
CREATE INDEX IF NOT EXISTS idx_shtab_tseh_code_embedding
    ON public.shtab_tseh_code USING hnsw (embedding vector_cosine_ops);

COMMENT ON TABLE public.shtab_tseh_code IS
    'Логика ЦехУспеха: функции MySQL, структура таблиц, формы Delphi. Только чтение источника, копия для поиска.';

ALTER TABLE public.shtab_tseh_code ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shtab_tseh_code_service_role_write ON public.shtab_tseh_code;
CREATE POLICY shtab_tseh_code_service_role_write
    ON public.shtab_tseh_code FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON public.shtab_tseh_code TO postgres, service_role;

-- Поиск с необязательным сужением по виду: вопрос «что лежит в таблице заказов»
-- не должен вытаскивать двадцать кусков Delphi.
CREATE OR REPLACE FUNCTION public.match_shtab_tseh_code(
    query_embedding vector(1536),
    match_threshold float,
    match_count int,
    filter_kind text DEFAULT NULL
)
RETURNS TABLE (
    slug       text,
    kind       text,
    name       text,
    title      text,
    content    text,
    source_ref text,
    similarity float
)
LANGUAGE sql
STABLE
AS $function$
    SELECT c.slug, c.kind, c.name, c.title, c.content, c.source_ref,
           1 - (c.embedding <=> query_embedding) AS similarity
      FROM public.shtab_tseh_code c
     WHERE c.is_active
       AND c.embedding IS NOT NULL
       AND (filter_kind IS NULL OR c.kind = filter_kind)
       AND 1 - (c.embedding <=> query_embedding) > match_threshold
     ORDER BY c.embedding <=> query_embedding
     LIMIT match_count;
$function$;

COMMENT ON FUNCTION public.match_shtab_tseh_code(vector, float, int, text) IS
    'Поиск по логике ЦехУспеха косинусной близостью.';
