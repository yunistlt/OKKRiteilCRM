-- Тамара — консультант владельца.
--
-- До сих пор Тамара была набором детерминированных правил: проверяла написанное
-- по методичке и молчала обо всём остальном. Здесь появляется второй слой —
-- разговор и еженедельная сводка на живых данных.
--
-- Разделение слоёв принципиально и сохраняется:
--   * правила методички остаются в коде (lib/shtab/checks.ts, покрыты тестами) —
--     менять надёжную проверку на вероятностную незачем;
--   * всё, что Тамара говорит О КОМПАНИИ, приходит из инструментов, которые
--     возвращают настоящие строки. Модель не получает доступа к SQL;
--   * знания по управлению лежат здесь, в базе знаний, и ищутся по смыслу —
--     системный промпт не резиновый и не проверяем.
--
-- Миграция аддитивная и идемпотентная.

CREATE EXTENSION IF NOT EXISTS vector;

-- ── база знаний ────────────────────────────────────────────────────────────────
-- Методичка «Альянс Стратег» плюс управленческий канон. Устройство повторяет
-- okk_consultant_knowledge (миграция 20260416): тот же размер вектора, тот же
-- индекс, та же схема прав — чтобы поиск по знаниям в проекте был один и тот же,
-- а не два похожих.
CREATE TABLE IF NOT EXISTS public.shtab_kb (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       text NOT NULL UNIQUE,
    -- methodology — из методички «Альянс Стратег»;
    -- framework  — управленческий подход (EOS, теория ограничений, XmR и прочее);
    -- glossary   — термин.
    type       text NOT NULL CHECK (type IN ('methodology', 'framework', 'glossary')),
    title      text NOT NULL,
    content    text NOT NULL,
    tags       text[] NOT NULL DEFAULT '{}'::text[],
    -- откуда взято: Тамара обязана называть источник, а не выдавать чужую мысль
    -- за свою и не ссылаться на книгу, которой не читала.
    source_ref text NOT NULL DEFAULT '',
    is_active  boolean NOT NULL DEFAULT true,
    embedding  vector(1536),
    -- отпечаток текста, по которому считался эмбеддинг: повторный засев не
    -- пересчитывает то, что не менялось, а это платный вызов
    metadata_fingerprint text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- на случай, если таблица уже была создана ранней версией миграции
ALTER TABLE public.shtab_kb ADD COLUMN IF NOT EXISTS metadata_fingerprint text;

CREATE INDEX IF NOT EXISTS idx_shtab_kb_active ON public.shtab_kb (is_active, type);
CREATE INDEX IF NOT EXISTS idx_shtab_kb_embedding
    ON public.shtab_kb USING hnsw (embedding vector_cosine_ops);

COMMENT ON TABLE public.shtab_kb IS
    'Знания Тамары: методичка «Альянс Стратег» и управленческий канон. Ищется по смыслу.';

ALTER TABLE public.shtab_kb ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shtab_kb_service_role_write ON public.shtab_kb;
CREATE POLICY shtab_kb_service_role_write
    ON public.shtab_kb FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON public.shtab_kb TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.match_shtab_kb(
    query_embedding vector(1536),
    match_threshold float,
    match_count int
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
     ORDER BY k.embedding <=> query_embedding
     LIMIT match_count;
$function$;

COMMENT ON FUNCTION public.match_shtab_kb(vector, float, int) IS
    'Поиск по знаниям Тамары косинусной близостью.';

-- ── еженедельная сводка ────────────────────────────────────────────────────────
-- Тамара начинает разговор сама: раз в неделю смотрит данные и говорит, что
-- изменилось и чем заняться. Сводка хранится, а не пересобирается при каждом
-- открытии, по двум причинам: она должна быть одна и та же в течение недели
-- (иначе на неё нельзя сослаться), и каждый показ раздела не должен стоить
-- вызова модели.
CREATE TABLE IF NOT EXISTS public.shtab_briefing (
    id          bigserial PRIMARY KEY,
    -- понедельник недели, за которую сводка; уникален, чтобы повторный запуск
    -- задания не плодил дубли
    week_start  date NOT NULL UNIQUE,
    text        text NOT NULL,
    -- на что смотрела: список вызванных инструментов с их параметрами.
    -- Без этого сводку нельзя проверить, а непроверяемому совету цена ноль.
    looked_at   jsonb NOT NULL DEFAULT '[]'::jsonb,
    model       text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shtab_briefing_week ON public.shtab_briefing (week_start DESC);

COMMENT ON TABLE public.shtab_briefing IS
    'Понедельничная сводка Тамары. looked_at — какие инструменты она вызывала, чтобы её собрать.';

-- ── история разговора ──────────────────────────────────────────────────────────
-- Штаб один на компанию, поэтому разговор тоже один: это диалог владельца с
-- наставницей, а не переписка пользователей.
CREATE TABLE IF NOT EXISTS public.shtab_tamara_message (
    id         bigserial PRIMARY KEY,
    role       text NOT NULL CHECK (role IN ('user', 'assistant')),
    text       text NOT NULL,
    -- какие инструменты вызывались ради этого ответа
    used_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shtab_tamara_message_created
    ON public.shtab_tamara_message (created_at DESC);

COMMENT ON TABLE public.shtab_tamara_message IS
    'Разговор владельца с Тамарой. Один на компанию, как и сам Штаб.';

-- ── промпты ────────────────────────────────────────────────────────────────────
-- Лежат в ai_prompts, как у остальных агентов: правятся в админке без деплоя.
-- Запрет на выдуманные числа стоит в системном промпте первым абзацем и
-- продублирован в коде, который собирает сообщение: одного места мало, промпт
-- можно отредактировать.
INSERT INTO public.ai_prompts (key, description, system_prompt, user_prompt_template, model, temperature, max_tokens)
VALUES (
    'shtab_tamara_chat',
    'Тамара: разговор с владельцем в Штабе',
    'Ты Тамара — консультант владельца завода металлоконструкций. Ведёшь его по методологии «Альянс Стратег».

ГЛАВНОЕ ПРАВИЛО. Ты не знаешь о компании ничего, кроме того, что вернули инструменты. Любое число, имя, дата и факт о компании берутся только из ответа инструмента. Если инструмент не вызывался или вернул пусто — так и скажи: «таких данных у меня нет». Никогда не оценивай «примерно», не достраивай недостающее и не называй правдоподобных величин. Владелец принимает по твоим словам решения о деньгах и людях.

Ссылайся на то, что смотрела: «по реестру минусов», «по выпискам за шесть месяцев». Если данных мало для вывода — скажи, каких именно не хватает.

КАК ГОВОРИШЬ. Коротко и по делу, на «ты». Без вводных оборотов и без ободрения. Сначала вывод, потом основание. Не перечисляешь всё подряд — называешь то, что важнее прочего, и объясняешь почему.

МЕТОДОЛОГИЯ. Работа идёт снизу вверх: минусы → область с наибольшим их числом → самый жирный минус → ситуация → «почему» с тремя критериями (внутри организации, устранима имеющимися ресурсами, даёт облегчение) → краткосрочная цель из двух частей → карта ресурсов → стратегия → проекты со сроками. Не даёшь перескакивать: пока не найдено «почему», улаживать нечего.

ЧЕГО НЕ ДЕЛАЕШЬ. Не заводишь и не закрываешь записи сама — предлагаешь, а решает владелец. Не споришь о фактах, которые вернул инструмент. Не выдаёшь общие управленческие советы там, где нужен разбор конкретной ситуации.

ЗНАНИЯ. В контексте могут быть выдержки из методички и из управленческого канона. Пользуйся ими и называй источник. Если знание из канона противоречит методичке — скажи об этом прямо и объясни разницу, а не выбирай молча.',
    'Вопрос владельца: {{question}}

Знания по теме:
{{knowledge_context}}

Предыдущий разговор:
{{history_context}}',
    'gpt-4o-mini',
    0.3,
    900
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.ai_prompts (key, description, system_prompt, user_prompt_template, model, temperature, max_tokens)
VALUES (
    'shtab_tamara_briefing',
    'Тамара: понедельничная сводка владельцу',
    'Ты Тамара — консультант владельца завода металлоконструкций. Раз в неделю ты первой начинаешь разговор: смотришь данные и говоришь, что изменилось и чем заняться на этой неделе.

ГЛАВНОЕ ПРАВИЛО. Все числа и факты берутся только из данных, которые тебе дали ниже. Ничего не достраиваешь и не оцениваешь на глаз. Если по какому-то показателю данных мало — так и пиши, это тоже сведение.

ЧТО ДОЛЖНО БЫТЬ В СВОДКЕ, в таком порядке:
1. Что изменилось за неделю по сравнению с предыдущей. Только то, что действительно изменилось.
2. Где сигнал, а где обычное колебание. Сигналом считается только то, что помечено сигналом в данных, — не решай этого сама.
3. Приоритетная область и почему она такая.
4. Одно дело на эту неделю. Именно одно: список из семи пунктов не делается никогда.

Пиши сплошным текстом, не списком, не длиннее пятнадцати строк. На «ты». Без приветствий и пожеланий хорошей недели.',
    'Данные за неделю:
{{week_data}}

Прошлая сводка (для сравнения, может отсутствовать):
{{previous_briefing}}',
    'gpt-4o-mini',
    0.3,
    700
)
ON CONFLICT (key) DO NOTHING;
