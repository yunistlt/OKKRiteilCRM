-- Шаблоны документов и писем — перенос функционала RetailCRM.
-- Тело шаблона — HTML с разметкой Twig/Nunjucks; контекст строится из raw_payload заказа,
-- то есть из того же объекта RetailCRM, что подставляют в свои шаблоны они.

CREATE TABLE IF NOT EXISTS public.document_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,          -- латиницей, для ссылки на форму из URL
    name TEXT NOT NULL,                 -- как видит менеджер: «Счёт», «Лист заказа»
    body TEXT NOT NULL,                 -- HTML + шаблонная разметка
    orientation TEXT NOT NULL DEFAULT 'portrait' CHECK (orientation IN ('portrait', 'landscape')),
    page_format TEXT NOT NULL DEFAULT 'A4',
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.email_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,              -- тема, тоже с подстановками
    body TEXT NOT NULL,                 -- HTML-тело письма
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_templates_active ON public.document_templates(active, sort_order);
CREATE INDEX IF NOT EXISTS idx_email_templates_active ON public.email_templates(active, sort_order);

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role full access" ON public.document_templates;
CREATE POLICY "service role full access" ON public.document_templates FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service role full access" ON public.email_templates;
CREATE POLICY "service role full access" ON public.email_templates FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_template_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_document_templates_touch ON public.document_templates;
CREATE TRIGGER trg_document_templates_touch BEFORE UPDATE ON public.document_templates
    FOR EACH ROW EXECUTE FUNCTION public.touch_template_updated_at();

DROP TRIGGER IF EXISTS trg_email_templates_touch ON public.email_templates;
CREATE TRIGGER trg_email_templates_touch BEFORE UPDATE ON public.email_templates
    FOR EACH ROW EXECUTE FUNCTION public.touch_template_updated_at();

COMMENT ON TABLE public.document_templates IS 'Печатные формы: HTML-шаблон, из которого собирается документ по заказу';
COMMENT ON TABLE public.email_templates IS 'Шаблоны писем: тема и тело с подстановками из заказа';
