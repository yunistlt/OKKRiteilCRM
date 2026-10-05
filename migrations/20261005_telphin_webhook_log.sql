-- Журнал сырых событий телефонии.
--
-- Формат события Телфин присылает по-разному (разные версии и подписки), и
-- гадать о нём нельзя. Пишем сюда всё, что пришло, — по журналу видно, что
-- приходит на самом деле, и разбор можно уточнить фактами.
--
-- Нужен на время настройки и дальше как чёрный ящик: когда звонок «не
-- показался», первый вопрос — пришло ли о нём событие вообще.
CREATE TABLE IF NOT EXISTS public.telphin_webhook_log (
    id          bigserial PRIMARY KEY,
    call_id     text,
    /** Что мы поняли о событии: ringing / answered / ended / unknown. */
    phase       text,
    payload     jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.telphin_webhook_log IS
    'Сырые события телефонии Телфина как есть. Чёрный ящик: пришло ли событие о звонке и в каком виде.';

CREATE INDEX IF NOT EXISTS idx_telphin_webhook_log_received ON public.telphin_webhook_log (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_telphin_webhook_log_call ON public.telphin_webhook_log (call_id) WHERE call_id IS NOT NULL;
