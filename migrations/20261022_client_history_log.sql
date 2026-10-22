-- История действий в карточке клиента — как в карточке заказа.
--
-- Решение владельца 22.10.2026: «менеджера клиента может менять любой
-- менеджер, важно хранить историю действий в карточке клиента так же как мы
-- храним в карточке заказа». До этого карточка менялась молча: кто передал
-- клиента, кто правил реквизиты и когда — не узнать.
--
-- Устройство повторяет order_history_log: поле, было, стало, кто и когда.
CREATE TABLE IF NOT EXISTS public.client_history_log (
    id           BIGSERIAL PRIMARY KEY,
    client_id    BIGINT      NOT NULL,
    field        TEXT        NOT NULL,
    old_value    TEXT,
    new_value    TEXT,
    -- Кто правил: имя и роль человека на момент записи (не ссылка — люди уходят).
    actor        JSONB,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_history_log_client_idx
    ON public.client_history_log (client_id, occurred_at DESC);

COMMENT ON TABLE public.client_history_log IS
    'История правок карточки клиента: менеджер, реквизиты, телефоны, контакты, объединение.';
