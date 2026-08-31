-- Штаб: Тамара опирается только на факты, а неизвестное спрашивает
--
-- До этой миграции Тамара знала о компании ровно то, что отдавали инструменты.
-- Всё остальное она могла только додумать — а додуманный факт о собственном
-- цехе владелец принимает за правду, потому что он звучит как своя же мысль.
--
-- Отсюда правило: не знаешь — спроси, а ответ зафиксируй. Хранение двухслойное,
-- и слои делают разное.
--
--   RAG (shtab_kb, тип 'company') — подробно: вопрос, ответ владельца дословно,
--   дата. Достаётся по смыслу вместе с методичкой.
--
--   Память (shtab_memory) — одна строка на тему, всегда в промпте. В ней НЕТ
--   самого факта, только отметка «про это знаю» и slug записи в базе знаний.
--
-- Зачем второй слой. Векторный поиск достаёт по похожести: если Тамара не
-- знает, что факт вообще существует, она его не найдёт и спросит второй раз.
-- Второй раз про то же — это не мелкое неудобство, это потеря доверия: владелец
-- перестаёт отвечать. Память работает указателем и всегда перед глазами.
--
-- Почему память не хранит сам факт: она грузится в каждый запрос. Хранить в ней
-- содержание — значит превратить её во второй контекст, который растёт без
-- границы и вытесняет разговор. Отметка короткая, содержание — по ссылке.
--
-- Достать факт можно ДВУМЯ путями: по вектору (как всё остальное знание) и
-- напрямую по slug из памяти. Второй путь важнее первого: он работает, даже
-- если эмбеддинг не посчитался (OpenAI недоступен). Иначе память обещала бы то,
-- чего поиск не находит, — та же ложь, только устроенная сложнее.
--
-- Миграция аддитивная: новый тип в справочнике, новая таблица, новая функция.

-- ── новый вид знания: факт о компании со слов владельца ───────────────────────
--
-- Отдельный тип, а не 'craft', по двум причинам. Первая: у факта есть срок
-- годности. Методичка написана раз и навсегда, а «начальников цеха двое»
-- перестанет быть правдой в тот день, когда возьмут третьего. Вторая: источник
-- другой — не книга, а владелец, и Тамара обязана это называть, отвечая.
ALTER TABLE public.shtab_kb DROP CONSTRAINT IF EXISTS shtab_kb_type_check;
ALTER TABLE public.shtab_kb ADD CONSTRAINT shtab_kb_type_check
    CHECK (type IN ('methodology', 'framework', 'glossary', 'craft', 'company'));

-- ── память: указатель, а не хранилище ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shtab_memory (
    id            bigserial PRIMARY KEY,
    -- тема одним словосочетанием: «начальники цеха», «печать ярлыков»
    topic         text NOT NULL,
    -- отметка «что известно», без самого факта: одна строка, которую видно в промпте
    note          text NOT NULL,
    -- ссылка в shtab_kb, где лежит подробность
    kb_slug       text NOT NULL,
    -- как был задан вопрос: чтобы владелец видел, на что он отвечал
    asked         text NOT NULL DEFAULT '',
    -- откуда факт: пока только владелец, но столбец нужен сразу — иначе завтра
    -- сюда попадёт факт из цеха и станет неотличим от сказанного владельцем
    source        text NOT NULL DEFAULT 'owner' CHECK (source IN ('owner', 'tseh', 'doc')),
    -- факты меняются. Старую строку не переписываем, а закрываем: иначе история
    -- переписывается задним числом и вчерашний ответ Тамары нечем объяснить.
    superseded_at timestamptz,
    superseded_by bigint REFERENCES public.shtab_memory(id),
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- одна живая строка на тему; закрытые лежат сколько угодно
CREATE UNIQUE INDEX IF NOT EXISTS idx_shtab_memory_topic_live
    ON public.shtab_memory (lower(topic)) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shtab_memory_live
    ON public.shtab_memory (created_at DESC) WHERE superseded_at IS NULL;

COMMENT ON TABLE public.shtab_memory IS
    'Память Тамары: по какой теме факт уже выяснен и под каким slug лежит подробность в shtab_kb. Самого факта здесь нет.';
COMMENT ON COLUMN public.shtab_memory.note IS
    'Одна строка «что известно». Грузится в каждый запрос, поэтому короткая.';

ALTER TABLE public.shtab_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shtab_memory_service_role_write ON public.shtab_memory;
CREATE POLICY shtab_memory_service_role_write
    ON public.shtab_memory FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── запись факта одной транзакцией ────────────────────────────────────────────
--
-- Два слоя пишутся вместе или не пишутся вовсе. Полузапись здесь — худший исход:
-- память говорит «знаю», а в базе знаний пусто, и Тамара уверенно ссылается на то,
-- чего нет.
--
-- Эмбеддинг приходит готовым (считается в TS, это платный вызов). NULL допустим:
-- факт всё равно достаётся по slug из памяти. Вектор — второй путь, не первый.
CREATE OR REPLACE FUNCTION public.shtab_remember(
    p_topic     text,
    p_note      text,
    p_slug      text,
    p_title     text,
    p_content   text,
    p_asked     text DEFAULT '',
    p_source    text DEFAULT 'owner',
    p_source_ref text DEFAULT '',
    p_embedding vector(1536) DEFAULT NULL,
    p_fingerprint text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_id bigint;
    v_new_id bigint;
BEGIN
    IF coalesce(btrim(p_topic), '') = '' THEN
        RAISE EXCEPTION 'Тема пустая: без неё память не ищется и не перезаписывается';
    END IF;
    IF coalesce(btrim(p_content), '') = '' THEN
        RAISE EXCEPTION 'Содержание пустое: записывать в базу знаний нечего';
    END IF;

    INSERT INTO public.shtab_kb
        (slug, type, title, content, tags, source_ref, is_active, embedding, metadata_fingerprint, updated_at)
    VALUES
        (p_slug, 'company', p_title, p_content, ARRAY['company', p_source]::text[],
         p_source_ref, true, p_embedding, p_fingerprint, now())
    ON CONFLICT (slug) DO UPDATE SET
        title      = EXCLUDED.title,
        content    = EXCLUDED.content,
        tags       = EXCLUDED.tags,
        source_ref = EXCLUDED.source_ref,
        is_active  = true,
        -- эмбеддинг не затираем нулём: если новый не посчитался, лучше искать по
        -- старому вектору, чем не искать вовсе
        embedding  = COALESCE(EXCLUDED.embedding, public.shtab_kb.embedding),
        metadata_fingerprint = COALESCE(EXCLUDED.metadata_fingerprint, public.shtab_kb.metadata_fingerprint),
        updated_at = now();

    SELECT id INTO v_old_id
      FROM public.shtab_memory
     WHERE lower(topic) = lower(btrim(p_topic)) AND superseded_at IS NULL;

    -- Старую строку закрываем ДО вставки новой. Живая строка на тему по индексу
    -- ровно одна, и вставка при живой старой падает — проверено на живом
    -- Postgres 16. При обратном порядке любой уточнённый владельцем факт
    -- ронял бы запись, а Тамара спрашивала бы про то же снова.
    IF v_old_id IS NOT NULL THEN
        UPDATE public.shtab_memory SET superseded_at = now() WHERE id = v_old_id;
    END IF;

    INSERT INTO public.shtab_memory (topic, note, kb_slug, asked, source)
    VALUES (btrim(p_topic), p_note, p_slug, coalesce(p_asked, ''), p_source)
    RETURNING id INTO v_new_id;

    -- Ссылку на замену проставляем после: она указывает на строку, которой до
    -- вставки ещё не было.
    IF v_old_id IS NOT NULL THEN
        UPDATE public.shtab_memory SET superseded_by = v_new_id WHERE id = v_old_id;
    END IF;

    RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.shtab_remember(text, text, text, text, text, text, text, text, vector, text) IS
    'Записывает выясненный факт в оба слоя одной транзакцией: подробность в shtab_kb, отметку в shtab_memory. Прежнюю отметку по теме закрывает, а не затирает.';

-- ── правило в промпте: не знаешь — спроси ────────────────────────────────────
UPDATE public.ai_prompts
   SET system_prompt = system_prompt || E'\n\n' ||
'ФАКТЫ О КОМПАНИИ — ТОЛЬКО ИЗВЕСТНЫЕ.

Ты не знаешь о цехе ничего, кроме того, что пришло из инструментов, из блока
ПАМЯТЬ и из базы знаний с пометкой «со слов владельца». Всё остальное —
догадка, даже если она выглядит правдоподобно и подходит по смыслу.

Правдоподобная догадка опаснее ошибки: владелец узнаёт в ней собственную мысль
и не проверяет. Один выдуманный факт в программе — и по ней отчитаются.

Поэтому:
1. Не хватает факта для ответа — спроси владельца одним прямым вопросом. Не
   формулируй за него ответ и не подсказывай вариант, который тебе удобен.
2. Не заполняй пропуск похожим фактом из другого места. Отсутствие факта — это
   тоже ответ, и его надо назвать вслух: «этого я не знаю».
3. Получил ответ — сразу вызови shtab_zapomnit. Незаписанный ответ придётся
   спрашивать снова, а второй раз про то же владелец уже не объясняет.
4. В ответе владельцу называй источник факта: инструмент, память или его
   собственные слова с датой. Факт со слов человека и факт из базы — разного
   веса, и он должен видеть, что чем является.
5. Факт из памяти мог устареть. Если он старше полугода и от него зависит
   решение — переспроси, а не подставляй молча.'
 WHERE key IN ('shtab_tamara_chat', 'shtab_tamara_program')
   AND system_prompt NOT LIKE '%ФАКТЫ О КОМПАНИИ — ТОЛЬКО ИЗВЕСТНЫЕ%';
