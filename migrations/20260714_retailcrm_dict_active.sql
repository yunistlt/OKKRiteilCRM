-- Add `active` flag to retailcrm_dictionaries.
-- ЗАКОН: работаем только с активными сущностями RetailCRM. reference/* items
-- (statuses, order/payment/delivery methods, sites, stores, product-statuses)
-- отдают `active` в API v5 — храним его, потребители фильтруют active=true.
-- Кастом-поля и элементы справочников (entity_type='customField') флаг НЕ отдают —
-- для них колонка остаётся DEFAULT true (неактивные RetailCRM не возвращает в API,
-- их прунит существующий sync по updated_at).
ALTER TABLE retailcrm_dictionaries
    ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
