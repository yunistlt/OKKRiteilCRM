-- Очередь заказов в производство: ЦехУспех забирает их отсюда сам.
--
-- Решение владельца 02.10.2026: таблица живёт у НАС, а не в базе ЦехУспеха.
-- Так никому не нужна запись в чужую боевую базу: мы пишем у себя, ЦехУспех
-- приходит с доступом на чтение и забирает по своему расписанию или по хуку.
--
-- Строка появляется, когда заказ переходит в «Передано в производство».
-- Повторно один заказ не кладём — номер заказа уникален.
--
-- Проверено перед заведением: таблиц с outbox/inbox/production под эту задачу
-- в базе нет (`shtab_tamara_outbox` — исходящие сообщения Тамары, другое).

CREATE TABLE IF NOT EXISTS public.tseh_production_outbox (
    id               bigserial PRIMARY KEY,
    -- Номер заказа ОКК («900041», «54836») — ключ связи между системами.
    order_number     text NOT NULL UNIQUE,
    order_id         bigint,
    -- Заказчик: как он называется в документах, и ИНН для однозначности.
    customer_name    text,
    customer_inn     text,
    manager_name     text,
    -- Срок изготовления в рабочих днях и как клиент получает товар.
    production_days  integer,
    shipping_terms   text,
    -- Позиции: название, количество, цена. Массивом, как в заказе.
    items            jsonb NOT NULL DEFAULT '[]'::jsonb,
    total_summ       numeric(14, 2),
    manager_comment  text,
    -- Когда мы положили заказ в очередь.
    created_at       timestamptz NOT NULL DEFAULT now(),

    -- Ниже — поля для ЦехУспеха. Он их и заполняет, когда забирает заказ.
    taken_at         timestamptz,
    processed_at     timestamptz,
    tseh_order_no    text,
    error            text
);

CREATE INDEX IF NOT EXISTS idx_tseh_outbox_new
    ON public.tseh_production_outbox (created_at)
    WHERE processed_at IS NULL;

COMMENT ON TABLE public.tseh_production_outbox IS
    'Заказы, переданные в производство: ЦехУспех забирает их отсюда сам';
COMMENT ON COLUMN public.tseh_production_outbox.taken_at IS 'Когда ЦехУспех взял заказ в работу (заполняет ЦехУспех)';
COMMENT ON COLUMN public.tseh_production_outbox.processed_at IS 'Когда ЦехУспех завёл заказ у себя (заполняет ЦехУспех)';
COMMENT ON COLUMN public.tseh_production_outbox.tseh_order_no IS 'Номер заказа в ЦехУспехе (заполняет ЦехУспех)';
COMMENT ON COLUMN public.tseh_production_outbox.error IS 'Почему заказ не завёлся (заполняет ЦехУспех)';
