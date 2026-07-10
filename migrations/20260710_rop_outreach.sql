-- Артём (РОП-бот): триггер приглашения новых заявок на квалификацию.
-- Раз в 1-2 минуты крон /api/cron/rop-outreach находит новые заказы, назначает их
-- на бота-квалификатора (Теренков Андрей, manager_id=102), шлёт письмо с UTM-ссылкой
-- на виджет Елены в режиме квалификации и логирует отправку.
--
-- Безопасность: enabled = false по умолчанию — в этом режиме крон работает в «сухом»
-- прогоне (логирует, что бы сделал, но не переназначает и не шлёт живых писем).
-- Живые письма реальным клиентам уходят только после включения enabled = true.

-- ── Настройки (единственная строка id = 1) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rop_outreach_settings (
    id                   SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled              BOOLEAN  NOT NULL DEFAULT false,  -- master-тумблер живой отправки
    exclude_known_clients BOOLEAN NOT NULL DEFAULT false,  -- постоянных тоже приглашаем (короткая квалификация)
    require_legal_entity BOOLEAN  NOT NULL DEFAULT false,   -- только юрлица (по умолч. все)
    rate_per_hour        INTEGER  NOT NULL DEFAULT 10,      -- потолок отправок в час
    bot_manager_id       BIGINT   NOT NULL DEFAULT 102,     -- Теренков Андрей (rop@zmktlt.ru)
    pickup_status        TEXT     NOT NULL DEFAULT 'novyi-1',-- статус «новый» для отбора
    timeout_hours        INTEGER  NOT NULL DEFAULT 24,      -- рабочих часов (без выходных) до возврата зависшей
    site_base_url        TEXT     NOT NULL DEFAULT 'https://www.zmktlt.ru',
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.rop_outreach_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ── Лог отправок (анти-дубль + rate-cap + дедлайн возврата) ─────────────────
CREATE TABLE IF NOT EXISTS public.rop_outreach_log (
    order_id            BIGINT PRIMARY KEY,          -- RetailCRM order id
    order_number        TEXT,
    email_to            TEXT,
    outcome             TEXT NOT NULL,               -- sent | dry_run | skipped_no_email |
                                                     -- skipped_known | skipped_rate | failed | returned
    reason              TEXT,
    original_manager_id BIGINT,                      -- кому заявка принадлежала до бота (для возврата)
    deadline_at         TIMESTAMPTZ,                 -- когда вернуть заявку живому менеджеру
    returned_at         TIMESTAMPTZ,                 -- когда фактически вернули
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rop_outreach_log_outcome ON public.rop_outreach_log (outcome);
CREATE INDEX IF NOT EXISTS idx_rop_outreach_log_created ON public.rop_outreach_log (created_at);
CREATE INDEX IF NOT EXISTS idx_rop_outreach_log_deadline
    ON public.rop_outreach_log (deadline_at)
    WHERE outcome = 'sent' AND returned_at IS NULL;
