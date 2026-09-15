-- Типы контрагента RetailCRM — фиксированный перечень API (contragentType), в
-- reference/* его нет, поэтому он не попадает в синк. Заводим как справочник,
-- чтобы карточка заказа показывала русское имя, а не код (ЗАКОН «только
-- человеческий язык»). Имена — как в интерфейсе RetailCRM.
INSERT INTO retailcrm_dictionaries (entity_type, dictionary_code, item_code, item_name, active, updated_at)
SELECT v.entity_type, NULL, v.item_code, v.item_name, true, now()
FROM (VALUES
    ('contragentType', 'individual',   'Физическое лицо'),
    ('contragentType', 'legal-entity', 'Юридическое лицо'),
    ('contragentType', 'enterpreneur', 'Индивидуальный предприниматель')
) AS v(entity_type, item_code, item_name)
WHERE NOT EXISTS (
    SELECT 1 FROM retailcrm_dictionaries d
    WHERE d.entity_type = v.entity_type AND d.item_code = v.item_code AND d.dictionary_code IS NULL
);
