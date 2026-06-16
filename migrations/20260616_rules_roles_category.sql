-- Таргетинг правил ОКК на роли (группы пользователей RetailCRM) и категории-группировки.
-- Аддитивно и обратносовместимо: пустой target_roles = правило применяется ко ВСЕМ ролям.

ALTER TABLE public.okk_rules
  ADD COLUMN IF NOT EXISTS target_roles text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.okk_rules
  ADD COLUMN IF NOT EXISTS category text;

COMMENT ON COLUMN public.okk_rules.target_roles IS
  'Коды групп пользователей RetailCRM (retailcrm_dictionaries.item_code, entity_type=userGroup), которые оценивает правило. Пусто = все роли.';
COMMENT ON COLUMN public.okk_rules.category IS
  'Категория-группировка правила в списке (человекочитаемая, напр. «В конце диалога»).';
