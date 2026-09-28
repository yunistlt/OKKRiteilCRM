-- Журнал действий юридического отдела.
--
-- Код писал в `legal_audit_log` с самого появления контура договоров, а таблицы
-- в базе не было: supabase-js на отсутствующую таблицу не бросает исключение, а
-- возвращает ошибку в поле error — её никто не проверял, и записи молча терялись.
-- Обнаружено прогоном раздела ИП 28.09.2026.
CREATE TABLE IF NOT EXISTS public.legal_audit_log (
    id            bigserial PRIMARY KEY,
    action        text NOT NULL,      -- legal_enforcement_case_created, legal_contract_upload_prepared, ...
    entity        text,               -- legal_enforcement_case | legal_contract_review | ...
    entity_id     bigint,
    performed_by  text,               -- id пользователя
    details       jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_audit_entity ON public.legal_audit_log (entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_legal_audit_created ON public.legal_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_audit_action ON public.legal_audit_log (action);
