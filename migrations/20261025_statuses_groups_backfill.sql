-- У каждого статуса есть этап — и у исторических тоже.
--
-- В crm_statuses 138 статусов остались без группы: это история, доселённая
-- из таблицы `statuses` (отменённые, «Цех-успех», старые воронки). Без этапа
-- ломается не показ, а расчёт: оплаты не переводят заказ в производство,
-- если он уже в «Производстве», «Отменен», «Доставке» и т.п., и определяют
-- это по названию этапа. Потеряв этап у 86 статусов, бот начал бы дёргать
-- закрытые заказы.
--
-- Поэтому: недостающие этапы заводим неактивными (на доске их не видно,
-- законом «только активные сущности» показ ограничен), и проставляем этап
-- каждому историческому статусу.
insert into crm_status_groups (code, name, ordering, active)
select distinct
       regexp_replace(lower(s.group_name), '[^a-zа-я0-9]+', '-', 'g'),
       s.group_name,
       900,
       false
from statuses s
where s.group_name is not null
  and not exists (select 1 from crm_status_groups g where g.name = s.group_name)
on conflict (code) do nothing;

update crm_statuses c
set group_id = g.id,
    updated_at = now()
from statuses s
join crm_status_groups g on g.name = s.group_name
where (s.code = c.code or s.code = c.external_code)
  and c.group_id is null;
