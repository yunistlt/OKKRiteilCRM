-- Сторож баланса OpenAI: снимки баланса + порог алерта.
-- OpenAI не отдаёт остаток счёта по API (только session key из браузера),
-- поэтому остаток считаем сами: последний снимок минус наши расходы (ai_usage_events) после него.

-- Снимок баланса: сколько денег на счёте ПОСЛЕ пополнения (в валюте счёта — USD).
CREATE TABLE IF NOT EXISTS ai_balance_snapshots (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    balance_usd  numeric NOT NULL,
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_balance_snapshots_occurred_at_idx
    ON ai_balance_snapshots (occurred_at DESC);

-- Настройки сторожа (без хардкода в коде).
ALTER TABLE ai_cost_settings
    ADD COLUMN IF NOT EXISTS usd_to_eur          numeric NOT NULL DEFAULT 0.92,
    ADD COLUMN IF NOT EXISTS balance_alert_eur   numeric NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS balance_alert_mute_hours numeric NOT NULL DEFAULT 6;
