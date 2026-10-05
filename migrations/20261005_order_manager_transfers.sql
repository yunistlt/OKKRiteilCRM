-- Журнал переводов заказа между менеджерами (решение владельца 05.10.2026).
--
-- Менеджеры переводят заказы сами, но каждый перевод записывается с причиной:
-- возможность временная, и по этим записям надо понять, почему система раздала
-- заказ не тому, — чтобы она сразу назначала правильного менеджера.
--
-- Отдельная таблица, а не order_history_log: там лежит история RetailCRM со
-- своей нумерацией (retailcrm_history_id), причины в ней нет и места под неё
-- тоже, а дописывать чужую историю своими строками нельзя.
CREATE TABLE IF NOT EXISTS public.order_manager_transfers (
    id              bigserial PRIMARY KEY,
    order_id        bigint NOT NULL,
    order_number    text,
    from_manager_id bigint,
    to_manager_id   bigint NOT NULL,
    reason          text NOT NULL,
    actor           text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_manager_transfers_order_idx
    ON public.order_manager_transfers (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_manager_transfers_created_idx
    ON public.order_manager_transfers (created_at DESC);

COMMENT ON TABLE public.order_manager_transfers IS
    'Переводы заказов между менеджерами с причиной — материал для правил автоназначения';
