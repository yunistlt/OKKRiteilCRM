-- Связь «статус → группа статусов» и порядок сортировки.
-- Нужна для левой колонки списка заказов: RetailCRM группирует статусы по этапам
-- («Новый», «Согласование», «На оплате»), а у нас группы синкались отдельным списком,
-- без ссылки от статуса — собрать дерево было не из чего.

ALTER TABLE public.retailcrm_dictionaries
    ADD COLUMN IF NOT EXISTS group_code TEXT,
    ADD COLUMN IF NOT EXISTS ordering INT;

CREATE INDEX IF NOT EXISTS idx_retailcrm_dictionaries_group
    ON public.retailcrm_dictionaries(entity_type, group_code, ordering);

COMMENT ON COLUMN public.retailcrm_dictionaries.group_code IS 'Для статусов — код группы статусов из RetailCRM';
COMMENT ON COLUMN public.retailcrm_dictionaries.ordering IS 'Порядок отображения из RetailCRM';
