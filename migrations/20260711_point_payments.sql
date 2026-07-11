-- Сервис распределения платежей «с точки» по заказам.
-- Источник: банк Точка (Точка.API, вебхуки incomingPayment / incomingSbpPayment).
-- Платёж нормализуется, матчится на заказ по номеру счёта из назначения платежа
-- (= номер заказа RetailCRM), при уверенном матче пробрасывается платежом в заказ RetailCRM.
-- Несопоставленные/неоднозначные — в очередь на ручной разбор (status = 'pending_match').
--
-- Миграция аддитивная, безопасна для повторного применения.

CREATE TABLE IF NOT EXISTS public.point_payments (
    id                    bigserial PRIMARY KEY,

    -- Источник и идемпотентность
    source                text        NOT NULL DEFAULT 'tochka',
    external_payment_id   text        NOT NULL,               -- Точка paymentId (совпадает с выпиской)
    webhook_type          text,                               -- incomingPayment | incomingSbpPayment | ...
    customer_code         text,                               -- customer_code счёта в Точке (скоуп «точки»)
    signature_verified    boolean     NOT NULL DEFAULT false, -- прошла ли проверка подписи JWT вебхука

    -- Сумма и дата
    amount_kopecks        bigint      NOT NULL,               -- сумма в копейках (целое, без float-погрешностей)
    currency              text        NOT NULL DEFAULT 'RUB',
    payment_date          date,
    payment_datetime      timestamptz,

    -- Реквизиты платежа
    purpose               text,                               -- назначение платежа (свободный текст)
    document_number       text,                               -- номер платёжного документа (напр. 3685)
    payer_name            text,
    payer_inn             text,
    payer_kpp             text,
    payer_account         text,
    payer_bank_bic        text,
    payer_bank_name       text,
    account_id            text,                               -- счёт получателя (наш)

    -- Матчинг
    status                text        NOT NULL DEFAULT 'pending_match',
        -- pending_match | matched | manual | ignored | failed
    match_method          text,                               -- order_number | inn_amount_date | manual
    match_confidence      text,                               -- high | medium | low
    extracted_invoice_number  text,                           -- основной извлечённый номер счёта
    extracted_invoice_numbers jsonb  NOT NULL DEFAULT '[]'::jsonb, -- все кандидаты из назначения
    match_candidates      jsonb       NOT NULL DEFAULT '[]'::jsonb, -- кандидаты-заказы для ручного разбора
    matched_order_number  text,
    matched_order_id      bigint,                             -- orders.order_id (id заказа в RetailCRM)

    -- Проброс в RetailCRM
    retailcrm_payment_id  text,                               -- id платежа в RetailCRM после создания
    retailcrm_synced_at   timestamptz,
    retailcrm_error       text,

    -- Ручной разбор
    review_note           text,
    reviewed_by           text,
    reviewed_at           timestamptz,

    -- Сырьё для аудита/реплея (декодированный payload вебхука)
    raw_payload           jsonb       NOT NULL DEFAULT '{}'::jsonb,

    processed_at          timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Идемпотентность: один платёж из источника — одна строка.
CREATE UNIQUE INDEX IF NOT EXISTS point_payments_source_extid_uidx
    ON public.point_payments (source, external_payment_id);

CREATE INDEX IF NOT EXISTS point_payments_status_idx
    ON public.point_payments (status);

CREATE INDEX IF NOT EXISTS point_payments_matched_order_number_idx
    ON public.point_payments (matched_order_number);

CREATE INDEX IF NOT EXISTS point_payments_payer_inn_idx
    ON public.point_payments (payer_inn);

CREATE INDEX IF NOT EXISTS point_payments_created_at_idx
    ON public.point_payments (created_at DESC);

COMMENT ON TABLE  public.point_payments IS 'Платежи «с точки» (банк Точка) и их привязка к заказам RetailCRM';
COMMENT ON COLUMN public.point_payments.external_payment_id IS 'paymentId из Точки — ключ идемпотентности (есть и в выписке)';
COMMENT ON COLUMN public.point_payments.amount_kopecks IS 'Сумма платежа в копейках (целое)';
COMMENT ON COLUMN public.point_payments.status IS 'pending_match | matched | manual | ignored | failed';
COMMENT ON COLUMN public.point_payments.signature_verified IS 'true — подпись JWT вебхука Точки проверена; авто-проброс в RetailCRM разрешён только для проверенных';
