-- ============================================================================
-- Звонок, который идёт ПРЯМО СЕЙЧАС.
--
-- Разделение владельца 05.10.2026: «звонок — это событие, которое происходит
-- прямо сейчас; запись звонка — результат события, которое уже произошло. Нам
-- нужно оповещение во время ЗВОНКА».
--
-- До сих пор у нас была только запись: телефония приезжала синхронизацией раз в
-- две минуты, и «оповещение о входящем» показывало прошедшее. Событий не было
-- вовсе — обработчик вебхука существовал, но лежал в файле `incoming.ts`, а
-- Next.js публикует маршрут только из `route.ts`, и адрес отвечал 404.
--
-- Эта таблица — короткая жизнь звонка: появляется, когда Телфин сообщил
-- «звонит», и гаснет, когда разговор начался или звонок сорвался. Браузер
-- слушает её через Supabase Realtime и показывает окно, пока телефон звонит.
-- История разговора здесь не живёт — она в `raw_telphin_calls`.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.active_calls (
    telphin_call_id text PRIMARY KEY,
    direction       text NOT NULL DEFAULT 'incoming',
    from_number     text,
    to_number       text,
    /** Добавочный, на который звонят: по нему видно, чей это телефон. */
    extension       text,
    manager_id      bigint,
    /** Кто звонит — название компании или имя человека из карточки. */
    client_name     text,
    client_id       bigint,
    order_id        bigint,
    order_number    text,
    /** ringing — телефон звонит, answered — подняли, ended — всё. */
    status          text NOT NULL DEFAULT 'ringing',
    started_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.active_calls IS
    'Звонки, идущие прямо сейчас. Наполняется вебхуком Телфина, читается интерфейсом через Realtime. Записи старше часа удаляются как зависшие.';

CREATE INDEX IF NOT EXISTS idx_active_calls_status ON public.active_calls (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_active_calls_manager ON public.active_calls (manager_id) WHERE manager_id IS NOT NULL;

-- Realtime: без этого браузер не получит ни одного события.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime' AND tablename = 'active_calls'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.active_calls;
    END IF;
EXCEPTION WHEN undefined_object THEN
    -- Публикации нет (локальная база без Realtime) — не повод ронять миграцию.
    NULL;
END $$;

-- Полная строка в событии обновления: иначе Realtime пришлёт только ключ, и
-- интерфейсу нечего будет показать.
ALTER TABLE public.active_calls REPLICA IDENTITY FULL;

-- Читать идущие звонки может любой вошедший: звонок видят все, кто на смене.
ALTER TABLE public.active_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS active_calls_read ON public.active_calls;
CREATE POLICY active_calls_read ON public.active_calls
    FOR SELECT TO authenticated USING (true);
