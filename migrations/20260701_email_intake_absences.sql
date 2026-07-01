-- Отпуска/отсутствия менеджеров для распределения заявок Катериной.
-- В период отсутствия менеджер ВЫПАДАЕТ из распределения НОВЫХ клиентов («поровну за период»),
-- но его ПОСТОЯННЫЕ клиенты (по истории заказов) продолжают идти к нему. Даты включительно.
-- Zero-hardcode: правится в интерфейсе Катерины.
CREATE TABLE IF NOT EXISTS public.email_intake_absences (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    manager_id BIGINT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_intake_absences_dates_idx ON public.email_intake_absences (start_date, end_date);

ALTER TABLE public.email_intake_absences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_intake_absences_service_role ON public.email_intake_absences;
CREATE POLICY email_intake_absences_service_role
    ON public.email_intake_absences FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
