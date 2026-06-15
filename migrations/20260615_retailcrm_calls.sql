-- Авторитетный инвентарь звонков из RetailCRM (GET /api/v5/telephony/calls).
-- RetailCRM отдаёт по звонку: externalId (= <extId>-<record_uuid> Телфина), orderNumber,
-- менеджера (id + добавочный), клиента, тип/дату/итог. Это источник истины для связки
-- звонок→заказ (надёжнее нашего эвристического lib/call-matching.ts) и для полноты:
-- RC видит звонки, которые наш прямой ингест из Telphin недозабирает.
--
-- record_uuid — ключ стыковки с аудио в raw_telphin_calls (через raw_payload.cdr[].record_uuid).
-- Аддитивно: только новая таблица + индексы, существующее поведение не меняется.

CREATE TABLE IF NOT EXISTS retailcrm_calls (
    rc_call_id        bigint PRIMARY KEY,            -- RetailCRM call id
    external_id       text,                          -- "<extId>-<record_uuid>" (id записи в Телфине)
    record_uuid       text,                          -- uuid-часть external_id (ключ стыковки с Telphin)
    call_type         text,                          -- in | out
    call_date         timestamptz,                   -- дата звонка (RC отдаёт в локальном времени, парсим как МСК)
    ext_code          text,                          -- добавочный (код менеджера в Телфине)
    manager_rc_id     text,                          -- id менеджера в RetailCRM
    manager_name      text,                          -- ФИО менеджера (для удобства/отладки)
    phone             text,                          -- номер абонента
    phone_normalized  text,                          -- последние 10 цифр
    order_number      text,                          -- номер связанного заказа (orders.number), может быть NULL
    customer_rc_id    text,                          -- id клиента в RetailCRM, может быть NULL
    is_missed         boolean,
    duration_sec      integer,
    result            text,                          -- answered | ...
    raw_payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
    ingested_at       timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Стыковка с аудио Telphin и поиск по заказу/дате.
CREATE INDEX IF NOT EXISTS idx_retailcrm_calls_record_uuid ON retailcrm_calls (record_uuid);
CREATE INDEX IF NOT EXISTS idx_retailcrm_calls_order_number ON retailcrm_calls (order_number);
CREATE INDEX IF NOT EXISTS idx_retailcrm_calls_call_date ON retailcrm_calls (call_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_retailcrm_calls_external_id ON retailcrm_calls (external_id);
