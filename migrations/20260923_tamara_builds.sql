-- Тамара собирает структуру сама и читает файлы, приложенные к разговору.
--
-- Миграция аддитивная и идемпотентная.

-- ── файлы, приложенные к разговору ─────────────────────────────────────────────
-- Владелец кидает в чат документ — Тамара читает его текст. Текст извлекается
-- при загрузке и лежит рядом с файлом: разбирать PDF на каждую реплику значило
-- бы платить за это каждый раз.
--
-- Файл принадлежит чату, а не реплике: приложенное в начале разговора нужно и
-- через десять вопросов, а привязка к реплике заставляла бы прикладывать заново.
CREATE TABLE IF NOT EXISTS public.shtab_tamara_file (
    id             bigserial PRIMARY KEY,
    chat_id        bigint NOT NULL REFERENCES public.shtab_tamara_chat(id) ON DELETE CASCADE,
    title          text NOT NULL,
    file_name      text NOT NULL,
    content_type   text NOT NULL DEFAULT '',
    size_bytes     bigint NOT NULL DEFAULT 0,
    storage_bucket text NOT NULL DEFAULT 'shtab-docs',
    storage_path   text NOT NULL,
    -- Пусто — текст извлечь не удалось; это видно и владельцу, и в контексте.
    text_content   text NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shtab_tamara_file_chat ON public.shtab_tamara_file (chat_id, created_at DESC);

COMMENT ON TABLE public.shtab_tamara_file IS
    'Файлы, приложенные к разговору с Тамарой. text_content — извлечённый текст, его и читает модель.';

-- ── откуда пришёл документ поста ───────────────────────────────────────────────
-- Импортированный из ЦехУспеха документ помечается, чтобы повторный импорт не
-- плодил копии и было видно, что файл не заводили руками.
ALTER TABLE public.shtab_post_doc
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'owner',
    ADD COLUMN IF NOT EXISTS external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shtab_post_doc_external
    ON public.shtab_post_doc (source, external_id) WHERE external_id IS NOT NULL;

COMMENT ON COLUMN public.shtab_post_doc.source IS
    'owner — загружено владельцем; tseh — импортировано из ЦехУспеха.';

-- ── Тамара теперь собирает структуру ───────────────────────────────────────────
-- Граница «советует, но не пишет» остаётся для минусов, разборов и проектов:
-- агент, который сам себе заводит минусы и сам их закрывает, за месяц
-- превратит реестр в мусор, а приоритетная область считается ровно по их числу.
-- Структура — другое: её никто не считает, она целиком описание, и собрать её
-- под диктовку быстрее, чем накликать.
UPDATE public.ai_prompts
   SET system_prompt = system_prompt || E'\n\nСТРУКТУРУ ТЫ СОБИРАЕШЬ САМА. Инструмент shtab_structure_apply заводит посты, подчиняет их друг другу, сажает людей и пишет ЦКП с обязанностями. Людей бери из tseh_people и сажай по идентификатору оттуда, а не по фамилии из головы. Работай так: сначала скажи вслух, что собираешься сделать, списком; примени; потом перечисли, что получилось, и спроси, что поправить. Не выдумывай посты, которых владелец не называл, и не переставляй подчинение, о котором не просили. Минусы, разборы и проекты ты по-прежнему не заводишь и не закрываешь — там решает владелец.\n\nФАЙЛЫ В РАЗГОВОРЕ. Владелец может приложить к разговору документ; его текст приходит тебе в контексте. Если текст пуст, так и скажи: файл не прочитался, и догадываться о его содержании нельзя.'
 WHERE key = 'shtab_tamara_chat'
   AND system_prompt NOT LIKE '%СТРУКТУРУ ТЫ СОБИРАЕШЬ САМА.%';

-- В шаблоне появляется место для приложенных файлов.
UPDATE public.ai_prompts
   SET user_prompt_template = replace(
           user_prompt_template,
           'Последние реплики этого разговора:',
           E'Файлы, приложенные к разговору:\n{{files_context}}\n\nПоследние реплики этого разговора:')
 WHERE key = 'shtab_tamara_chat'
   AND user_prompt_template NOT LIKE '%{{files_context}}%';
