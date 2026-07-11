-- ============================================================================
-- ЗП инженеров-расчётчиков ОП — модель участника (изолированная от менеджеров).
--
-- Инженеров-расчётчиков НЕТ как пользователей RetailCRM: они существуют только
-- как элементы справочника «Инженера ОП» (кастом-поле заказа `inzhener_zakaza`,
-- тип «справочник»); инженера в заказе проставляет менеджер. Поэтому их нельзя
-- вести через managers/salary_participant/группы CRM. Заводим ПАРАЛЛЕЛЬНУЮ ветку
-- участника, ключ = код элемента справочника (item_code), не пользователь CRM.
--
-- Реестр инженеров = пересечение: отмечен в salary_engineer_participant (кого
-- считаем) И имеет назначение схемы в salary_engineer_comp (пофамильно — у разных
-- инженеров могут быть разные ставки). Аналог managers: salary_participant +
-- salary_manager_comp.
--
-- Атрибуция заказа к инженеру — по customField `inzhener_zakaza` (см. RPC
-- salary_engineer_orders), НЕ по orders.manager_id. Один заказ считается и
-- менеджеру (за продажу), и инженеру (за расчёт) — по разным полям.
-- ============================================================================

-- Дискриминатор вида участника у схемы: 'manager' резолвится через группы CRM
-- (roles.ts), 'engineer' — через справочник инженеров (отдельная ветка). Без
-- этого схемы инженеров смешались бы с менеджерскими в резолве ролей/конструкторе.
ALTER TABLE public.salary_scheme
    ADD COLUMN IF NOT EXISTS participant_kind TEXT NOT NULL DEFAULT 'manager';

-- Опт-ин: какие элементы справочника «Инженера ОП» вообще считаем (инвариант
-- «никто лишний»). field_code — код кастом-поля-источника (на случай нескольких).
CREATE TABLE IF NOT EXISTS public.salary_engineer_participant (
    item_code   TEXT PRIMARY KEY,          -- код элемента справочника «Инженера ОП»
    field_code  TEXT NOT NULL DEFAULT 'inzhener_zakaza',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  TEXT
);

-- Назначение схемы инженеру (effective-dated, пофамильно). НАЛИЧИЕ назначения +
-- опт-ин = членство в реестре инженеров. Разные ставки % = разные схемы.
CREATE TABLE IF NOT EXISTS public.salary_engineer_comp (
    id             BIGSERIAL PRIMARY KEY,
    item_code      TEXT NOT NULL,          -- код элемента справочника «Инженера ОП»
    scheme_code    TEXT NOT NULL,          -- salary_scheme.code (participant_kind='engineer')
    effective_from DATE NOT NULL,
    created_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (item_code, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_salary_engineer_comp_item
    ON public.salary_engineer_comp (item_code, effective_from DESC);
