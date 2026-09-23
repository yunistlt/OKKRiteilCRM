-- Структура компании: посты становятся схемой, к ним крепятся документы.
--
-- Отдельной таблицы блоков нет намеренно. Блок схемы — это пост: у поста уже
-- есть образцовое положение дел, статистика и держатель, а второй справочник
-- «блоков» рядом с постами разъехался бы с ними через месяц.
--
-- Миграция аддитивная и идемпотентная.

-- ── место поста в структуре ────────────────────────────────────────────────────
ALTER TABLE public.shtab_post
    ADD COLUMN IF NOT EXISTS parent_id bigint REFERENCES public.shtab_post(id) ON DELETE SET NULL,
    -- Координаты холста: владелец расставляет блоки сам. Авто-раскладка сюда не
    -- лезет — схема, которую человек разложил руками, читается им быстрее любой
    -- правильной автоматической.
    ADD COLUMN IF NOT EXISTS pos_x int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pos_y int NOT NULL DEFAULT 0,
    -- ЦКП: что пост обязан выдавать наружу. Отдельно от образцового положения
    -- дел: там описание, а тут один продукт, по которому пост и оценивают.
    ADD COLUMN IF NOT EXISTS vkp text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS duties text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_shtab_post_parent ON public.shtab_post (parent_id);

COMMENT ON COLUMN public.shtab_post.parent_id IS 'Кому пост подчинён. NULL — верхний уровень схемы.';
COMMENT ON COLUMN public.shtab_post.vkp IS 'Ценный конечный продукт поста: что он выдаёт наружу.';
COMMENT ON COLUMN public.shtab_post.duties IS 'Обязанности поста, как они записаны в описании.';

-- Пост не может подчиняться сам себе или своему подчинённому.
--
-- Проверка в триггере, а не в приложении: цикл в дереве — это не «кривые
-- данные», а бесконечный обход при любом чтении структуры, и словить его надо
-- до записи. Приложение всё равно проверяет первым, чтобы сказать по-русски.
CREATE OR REPLACE FUNCTION public.shtab_post_no_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    cur bigint := NEW.parent_id;
    hops int := 0;
BEGIN
    IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
    IF NEW.parent_id = NEW.id THEN
        RAISE EXCEPTION 'Пост не может подчиняться сам себе';
    END IF;

    WHILE cur IS NOT NULL LOOP
        IF cur = NEW.id THEN
            RAISE EXCEPTION 'Так получается кольцо в подчинении';
        END IF;
        hops := hops + 1;
        IF hops > 100 THEN
            RAISE EXCEPTION 'Слишком глубокое подчинение — похоже на кольцо';
        END IF;
        SELECT p.parent_id INTO cur FROM public.shtab_post p WHERE p.id = cur;
    END LOOP;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_shtab_post_no_cycle ON public.shtab_post;
CREATE TRIGGER trg_shtab_post_no_cycle
    BEFORE INSERT OR UPDATE OF parent_id ON public.shtab_post
    FOR EACH ROW EXECUTE FUNCTION public.shtab_post_no_cycle();

-- ── раскладка холста одной операцией ───────────────────────────────────────────
-- Перетащили несколько блоков — координаты уезжают пачкой. По отдельности это
-- полдюжины запросов, и обрыв посередине оставил бы схему разорванной: часть
-- блоков на новых местах, часть на старых.
CREATE OR REPLACE FUNCTION public.shtab_post_layout_set(p_layout jsonb)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
    touched int := 0;
BEGIN
    UPDATE public.shtab_post p
       SET pos_x = (l->>'x')::int,
           pos_y = (l->>'y')::int,
           updated_at = now()
      FROM jsonb_array_elements(p_layout) AS l
     WHERE p.id = (l->>'id')::bigint;
    GET DIAGNOSTICS touched = ROW_COUNT;
    RETURN touched;
END $$;

COMMENT ON FUNCTION public.shtab_post_layout_set(jsonb) IS
    'Записывает координаты блоков схемы пачкой, в одной транзакции.';

-- ── документы поста ────────────────────────────────────────────────────────────
-- Должностные папки: описание поста, инструкции, регламенты. Текст извлекается
-- при загрузке и хранится рядом с файлом — иначе Тамара документ не прочитает,
-- а разбирать PDF на каждый её вопрос значило бы платить за это каждый раз.
CREATE TABLE IF NOT EXISTS public.shtab_post_doc (
    id             bigserial PRIMARY KEY,
    post_id        bigint NOT NULL REFERENCES public.shtab_post(id) ON DELETE CASCADE,
    title          text NOT NULL,
    file_name      text NOT NULL,
    content_type   text NOT NULL DEFAULT '',
    size_bytes     bigint NOT NULL DEFAULT 0,
    storage_bucket text NOT NULL DEFAULT 'shtab-docs',
    storage_path   text NOT NULL,
    -- Пусто — значит текст извлечь не удалось (скан без распознавания,
    -- неизвестный формат). Это видно в интерфейсе, а не прячется.
    text_content   text NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shtab_post_doc_post ON public.shtab_post_doc (post_id, created_at DESC);

COMMENT ON TABLE public.shtab_post_doc IS
    'Документы поста: описание, инструкции, регламенты. text_content — извлечённый текст для Тамары.';

-- ── Тамара знает про схему ─────────────────────────────────────────────────────
-- Абзац дописывается один раз: миграция идемпотентна.
UPDATE public.ai_prompts
   SET system_prompt = system_prompt || E'\n\nСТРУКТУРА. Оргсхему ведёт владелец вручную: инструмент shtab_structure отдаёт посты, подчинение, ЦКП, статистику, держателя и перечень документов поста. Текст документа читается инструментом shtab_post_doc. Пост без держателя — вакансия, а не ошибка данных. Пустой ЦКП или отсутствие документа — повод спросить, а не повод молчать: пост без ЦКП не с кого спрашивать результат. Про людей помни, что штат ведётся в ЦехУспехе и на схеме только работающие.'
 WHERE key = 'shtab_tamara_chat'
   AND system_prompt NOT LIKE '%СТРУКТУРА.%';
