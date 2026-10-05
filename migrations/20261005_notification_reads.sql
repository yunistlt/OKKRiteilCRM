-- Что человек уже прочитал в центре оповещений (решение владельца 05.10.2026:
-- «нужно сделать так же, как в RetailCRM — тут все оповещения менеджера,
-- каждый видит свои»).
--
-- Сами оповещения не храним: они собираются из писем, задач и звонков, которые
-- уже лежат в своих таблицах. Здесь только отметка «прочитано» — по одной
-- строке на человека и событие.
CREATE TABLE IF NOT EXISTS public.notification_reads (
    user_id   text NOT NULL,
    item_id   text NOT NULL,
    read_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS notification_reads_user_idx
    ON public.notification_reads (user_id, read_at DESC);

COMMENT ON TABLE public.notification_reads IS
    'Прочитанные оповещения: ключ события — тот же, что в ленте (mail-… / task-… / call-…)';
