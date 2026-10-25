-- Статусы живут в одной таблице: crm_statuses.
--
-- Рядом оставалась таблица `statuses` — та же сотня статусов во втором
-- экземпляре. Из-за двух источников экраны показывали код вместо названия
-- (25.10.2026). Переносим последнее, чего в crm_statuses не было, —
-- описание статуса для ИИ. Нормативы времени не переносим: в `statuses` у
-- всех 195 строк стоит одно и то же значение 5 (дефолт, его никто не
-- настраивал), а в crm_statuses нормативы выставлены людьми.
alter table crm_statuses add column if not exists ai_description text;

comment on column crm_statuses.ai_description is
    'Чем этот статус считается для ИИ: подсказка агентам при разборе заказа.';

update crm_statuses c
set ai_description = s.ai_description,
    updated_at = now()
from statuses s
where (c.code = s.code or c.external_code = s.code)
  and coalesce(s.ai_description, '') <> ''
  and coalesce(c.ai_description, '') = '';
