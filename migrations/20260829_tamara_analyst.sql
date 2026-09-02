-- Тамара получает право задать данным вопрос, которого никто не предусмотрел.
--
-- Разбор — это цепочка: увидел странное число, проверил догадку, увидел ещё
-- более странное. Каждый следующий запрос зависит от предыдущего ответа, и
-- заранее такой набор не напишешь. Шести готовых инструментов хватало, чтобы
-- ОТВЕЧАТЬ, и не хватало, чтобы РАЗБИРАТЬСЯ.
--
-- Свобода ограничена четырьмя рубежами: белый список таблиц в коде, проверка
-- текста запроса (только SELECT, один оператор), read-only транзакция с
-- таймаутом здесь, и журнал всех запросов.

CREATE TABLE IF NOT EXISTS public.shtab_query_log (
    id         bigserial PRIMARY KEY,
    sql        text NOT NULL,
    purpose    text NOT NULL DEFAULT '',
    row_count  int NOT NULL DEFAULT 0,
    error      text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shtab_query_log_at ON public.shtab_query_log (created_at DESC);

COMMENT ON TABLE public.shtab_query_log IS
    'Что Тамара спрашивала у базы. Единственный способ понять, откуда взялся её вывод.';

ALTER TABLE public.shtab_query_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shtab_query_log_rw ON public.shtab_query_log;
CREATE POLICY shtab_query_log_rw ON public.shtab_query_log FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.shtab_query_log TO postgres, service_role;
GRANT ALL ON SEQUENCE public.shtab_query_log_id_seq TO postgres, service_role;

-- Выполнение запроса в read-only транзакции с таймаутом.
--
-- Транзакция read-only — рубеж, который не обойти опечаткой в проверке текста:
-- даже если запись каким-то образом пройдёт текстовый фильтр, Postgres её не
-- выполнит. Таймаут в 15 секунд не даёт аналитическому запросу занять базу, на
-- которой работает вся компания.
CREATE OR REPLACE FUNCTION public.shtab_run_readonly_query(p_sql text)
RETURNS SETOF jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    rec jsonb;
BEGIN
    IF p_sql !~* '^\s*(select|with)\s' THEN
        RAISE EXCEPTION 'Разрешён только SELECT';
    END IF;
    IF p_sql ~ ';\s*\S' THEN
        RAISE EXCEPTION 'Разрешён только один оператор';
    END IF;

    PERFORM set_config('transaction_read_only', 'on', true);
    PERFORM set_config('statement_timeout', '15000', true);

    FOR rec IN EXECUTE 'SELECT to_jsonb(t) FROM (' || p_sql || ') t' LOOP
        RETURN NEXT rec;
    END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.shtab_run_readonly_query(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shtab_run_readonly_query(text) TO service_role;

-- Модель посильнее: разбор данных gpt-4o-mini не тянет — он отвечает, но не
-- рассуждает. Тариф gpt-4.1 в проекте уже заведён, поэтому учёт расхода
-- останется верным.
UPDATE public.ai_prompts SET model = 'gpt-4.1', max_tokens = 2000, updated_at = now()
 WHERE key = 'shtab_tamara_chat';
UPDATE public.ai_prompts SET model = 'gpt-4.1', max_tokens = 1500, updated_at = now()
 WHERE key = 'shtab_tamara_briefing';
