-- Конвейер заявок: ночью заказы уезжают в пул, днём возвращаются пачками.
--
-- Как работает отдел сейчас: менеджер открывает список своих заявок с фильтром
-- «запланировано на сегодня» и идёт по нему. Проблема не в фильтре, а в том,
-- что список длинный: в нём роются, выбирают полегче, дорогое остаётся на потом.
--
-- Механика простая. Ночью заказы из дневного плана переводятся на пользователя-
-- пул (по умолчанию — владелец), и у менеджера в CRM их не видно, потому что он
-- видит только свои. Утром возвращается первая пачка, дальше следующая — по
-- мере того, как по выданным появляется касание. Заказ никуда не пропадает:
-- вечером всё непереданное возвращается настоящему владельцу.
--
-- Именно поэтому исходный менеджер хранится здесь, а не выводится задним числом
-- из истории CRM: потерять владельца заказа — это потерять клиента.

CREATE TABLE IF NOT EXISTS public.sales_rop_queue (
    id            bigserial PRIMARY KEY,
    plan_date     date NOT NULL,
    order_id      bigint NOT NULL,
    order_number  text NOT NULL DEFAULT '',
    -- На ком заказ был до парковки. Возврат идёт только сюда.
    owner_id      bigint NOT NULL,
    -- Куда припарковали (пользователь-пул).
    parked_to_id  bigint NOT NULL,
    site          text NOT NULL DEFAULT '',
    ordinal       int NOT NULL DEFAULT 0,
    -- parked — лежит в пуле; released — отдан менеджеру; done — по нему было
    -- касание; returned — возвращён вечером, не дойдя до менеджера.
    state         text NOT NULL DEFAULT 'parked' CHECK (state IN ('parked','released','done','returned','failed')),
    parked_at     timestamptz,
    released_at   timestamptz,
    done_at       timestamptz,
    returned_at   timestamptz,
    error         text,
    UNIQUE (plan_date, order_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_rop_queue_state ON public.sales_rop_queue (plan_date, owner_id, state, ordinal);

COMMENT ON TABLE public.sales_rop_queue IS
    'Очередь выдачи заявок: кто настоящий владелец заказа, пока он лежит в пуле. Без этой таблицы владельца не восстановить.';

ALTER TABLE public.sales_rop_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_rop_queue_rw ON public.sales_rop_queue;
CREATE POLICY sales_rop_queue_rw ON public.sales_rop_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.sales_rop_queue TO postgres, service_role;
GRANT ALL ON SEQUENCE public.sales_rop_queue_id_seq TO postgres, service_role;

INSERT INTO public.sales_rop_settings (key, value, comment) VALUES
    ('queue_enabled', 'false', 'Включён ли конвейер: ночная парковка и выдача пачками'),
    ('queue_pool_manager_id', '102', 'Пользователь-пул RetailCRM, на котором заказы лежат до выдачи'),
    ('queue_batch_size', '2', 'Сколько заявок выдавать менеджеру за раз'),
    ('queue_manager_ids', '', 'Кому включён конвейер (id через запятую). Пусто — всем из плана')
ON CONFLICT (key) DO NOTHING;
