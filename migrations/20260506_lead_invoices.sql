-- Счета на оплату (банковский перевод — без онлайн-эквайринга)
CREATE TABLE IF NOT EXISTS public.lead_invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID REFERENCES public.widget_sessions(id) ON DELETE SET NULL,
    proposal_id     UUID REFERENCES public.lead_proposals(id) ON DELETE SET NULL,

    -- Реквизиты счёта
    invoice_number  TEXT NOT NULL UNIQUE, -- формат: ЗМК-2026-0001
    title           TEXT NOT NULL,
    items           JSONB NOT NULL DEFAULT '[]'::jsonb,
    discount_pct    NUMERIC(5,2) NOT NULL DEFAULT 0,
    total_amount    NUMERIC(12,2) NOT NULL,    -- итог с НДС
    vat_pct         NUMERIC(5,2) NOT NULL DEFAULT 20, -- ставка НДС

    -- Контактные данные плательщика
    payer_name      TEXT,
    payer_company   TEXT,
    payer_inn       TEXT,
    payer_kpp       TEXT,
    payer_address   TEXT,

    -- Состояние
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','sent','awaiting_payment','paid','cancelled','overdue')),
    token           TEXT NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex') UNIQUE,
    pdf_url         TEXT,
    due_date        DATE,           -- срок оплаты
    paid_at         TIMESTAMPTZ,    -- когда менеджер зафиксировал оплату
    sent_at         TIMESTAMPTZ,
    viewed_at       TIMESTAMPTZ,

    -- Служебное
    created_by      TEXT,           -- email менеджера
    manager_notes   TEXT,
    crm_note        TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Автоинкремент номера счёта
CREATE SEQUENCE IF NOT EXISTS lead_invoice_seq START 1;

-- Триггер updated_at
CREATE OR REPLACE FUNCTION set_lead_invoice_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_lead_invoice_updated_at
    BEFORE UPDATE ON public.lead_invoices
    FOR EACH ROW EXECUTE FUNCTION set_lead_invoice_updated_at();

-- Индексы
CREATE INDEX IF NOT EXISTS idx_lead_invoices_session   ON public.lead_invoices(session_id);
CREATE INDEX IF NOT EXISTS idx_lead_invoices_proposal  ON public.lead_invoices(proposal_id);
CREATE INDEX IF NOT EXISTS idx_lead_invoices_status    ON public.lead_invoices(status);
CREATE INDEX IF NOT EXISTS idx_lead_invoices_token     ON public.lead_invoices(token);

-- RLS
ALTER TABLE public.lead_invoices ENABLE ROW LEVEL SECURITY;
