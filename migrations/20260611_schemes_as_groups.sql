-- ============================================================================
-- Схема (роль) = ГРУППА пользователя RetailCRM напрямую: код схемы = код группы.
-- Убираем наши коды operator/seller и промежуточный salary_role_map.
-- seller  → menedzhery (Менеджеры ОП), operator → kollczentr (Коллцентр).
-- Имена схем берём из справочника групп (retailcrm_dictionaries / userGroup).
-- Идемпотентно. Блоки схем остаются (привязаны к scheme_id, не к коду).
-- ============================================================================

-- 1. Выбор схемы в реестре (для конфликтов) — перевести на новые коды.
UPDATE public.salary_manager_comp SET scheme_code = 'menedzhery' WHERE scheme_code = 'seller';
UPDATE public.salary_manager_comp SET scheme_code = 'kollczentr' WHERE scheme_code = 'operator';

-- 2. Переименовать схемы в коды групп + имя из справочника групп RetailCRM.
UPDATE public.salary_scheme s
   SET code = 'menedzhery',
       name = COALESCE((SELECT item_name FROM public.retailcrm_dictionaries
                        WHERE entity_type = 'userGroup' AND item_code = 'menedzhery' LIMIT 1), s.name)
 WHERE s.code = 'seller'
   AND NOT EXISTS (SELECT 1 FROM public.salary_scheme x WHERE x.code = 'menedzhery' AND x.effective_from = s.effective_from);

UPDATE public.salary_scheme s
   SET code = 'kollczentr',
       name = COALESCE((SELECT item_name FROM public.retailcrm_dictionaries
                        WHERE entity_type = 'userGroup' AND item_code = 'kollczentr' LIMIT 1), s.name)
 WHERE s.code = 'operator'
   AND NOT EXISTS (SELECT 1 FROM public.salary_scheme x WHERE x.code = 'kollczentr' AND x.effective_from = s.effective_from);

-- 3. Маппинг группа→схема больше не нужен (код схемы = код группы).
DROP TABLE IF EXISTS public.salary_role_map;
