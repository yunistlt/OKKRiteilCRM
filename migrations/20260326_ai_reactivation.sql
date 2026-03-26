-- ============================================================
-- Модуль: ИИ-Реактиватор B2B-клиентов (Агент Виктория)
-- Дата: 2026-03-26
-- ============================================================

-- Таблица кампаний реактивации
create table if not exists ai_reactivation_campaigns (
  id         uuid        default gen_random_uuid() primary key,
  title      text        not null,
  status     text        not null default 'active', -- active | paused | completed
  filters    jsonb       not null default '{}',     -- { b2b_only, months, min_ltv }
  created_at timestamptz default now()
);

-- Таблица логов / очереди рассылки (привязка к клиенту, не заказу)
create table if not exists ai_outreach_logs (
  id              uuid        default gen_random_uuid() primary key,
  campaign_id     uuid        references ai_reactivation_campaigns(id) on delete cascade,
  customer_id     integer     not null,  -- ID клиента в RetailCRM
  company_name    text,                  -- Название компании (для аналитики)
  customer_email  text,
  generated_email text,                  -- Сгенерированный текст письма
  status          text        not null default 'pending', -- pending | processing | sent | replied | error
  client_reply    text,                  -- Текст ответа клиента
  intent_status   text,                  -- POSITIVE | NEGATIVE | NEUTRAL
  sent_at         timestamptz,
  replied_at      timestamptz,
  created_at      timestamptz default now()
);

create index if not exists idx_outreach_customer_id  on ai_outreach_logs(customer_id);
create index if not exists idx_outreach_status        on ai_outreach_logs(status);
create index if not exists idx_outreach_campaign_id   on ai_outreach_logs(campaign_id);
