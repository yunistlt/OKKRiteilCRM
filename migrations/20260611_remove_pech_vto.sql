-- ============================================================================
-- Удаление рудимента «печь/ВТО». Категории товара — обычные (из RetailCRM),
-- премия за категории — добавочный блок premia_categorii. Спецсписок
-- category_pech_vto_map и ставка rate_zayavka.pech_vto больше не нужны.
-- Идемпотентно.
-- ============================================================================

-- 1. Убрать конфиг-ключ category_pech_vto_map (заменял тип клиента — больше нет).
DELETE FROM public.salary_config WHERE key = 'category_pech_vto_map';

-- 2. Убрать pech_vto из всех версий rate_zayavka (остаются new/permanent).
UPDATE public.salary_config
SET value = value #- '{pech_vto}'
WHERE key = 'rate_zayavka' AND value ? 'pech_vto';
