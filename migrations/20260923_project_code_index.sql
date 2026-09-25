-- Снимок исходного кода проекта, чтобы Тамара могла в него смотреть.
--
-- Зачем. Половина её ответов упирается в вопрос «а как это вообще работает» —
-- по какому правилу бот считает нагрузку, откуда берётся план, что значит
-- строка в отчёте. Раньше она этого знать не могла и отвечала общими словами
-- либо честно молчала. Человек в такой ситуации открывает код.
--
-- Почему снимок в базе, а не чтение из репозитория. В проде нет ни рабочей
-- копии (на Vercel едет сборка, а не исходники), ни доступа к GitHub. Снимок
-- заливается скриптом scripts/index-project-code.ts и несёт коммит, на котором
-- снят: ответ «по коду на такой-то коммит от такого-то числа» проверяем, а
-- ответ «по коду» — нет.

CREATE TABLE IF NOT EXISTS public.project_code_file (
    path         TEXT PRIMARY KEY,          -- путь от корня репозитория
    content      TEXT NOT NULL,
    lines        INT NOT NULL,
    bytes        INT NOT NULL,
    lang         TEXT,                      -- ts, tsx, sql, md
    commit_sha   TEXT NOT NULL,             -- на каком коммите снят файл
    indexed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Поиск по подстроке идёт по всему снимку: это главный способ им пользоваться,
-- ровно как grep. Триграммный индекс держит его быстрым без полнотекстовой
-- разметки — код плохо бьётся на слова, а искать в нём приходится куски вроде
-- `load_factor` и `from('orders')`.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_project_code_content_trgm
    ON public.project_code_file USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_project_code_path_trgm
    ON public.project_code_file USING gin (path gin_trgm_ops);

ALTER TABLE public.project_code_file ENABLE ROW LEVEL SECURITY;

-- Когда снят весь снимок целиком. Отдельной строкой, чтобы честно отвечать
-- «код от такого-то числа», даже если отдельные файлы не менялись годами.
CREATE TABLE IF NOT EXISTS public.project_code_snapshot (
    id          BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),  -- ровно одна строка
    commit_sha  TEXT NOT NULL,
    branch      TEXT,
    files       INT NOT NULL,
    taken_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_code_snapshot ENABLE ROW LEVEL SECURITY;
