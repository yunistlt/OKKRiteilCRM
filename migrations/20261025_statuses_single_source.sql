-- Имя статуса — в одной таблице, а не в двух.
--
-- Имена статусов лежали и в `crm_statuses` (доска «Статусы и переходы»), и в
-- `retailcrm_dictionaries` (старый справочник, оставшийся от импорта). Список
-- заказов читал только второй — и статусы, заведённые на доске, показывались
-- кодом: «dubl-zayavki» вместо «Дубль заявки» (25.10.2026).
--
-- Переносим недостающие имена на доску и дальше читаем только её. Исторические
-- статусы (отменённые, «старые», «битрикс») добавляем неактивными и без
-- группы: на доске они не показываются, но заказ в архиве подписан по-людски.
insert into crm_statuses (code, name, active, is_working, ordering, group_id)
select distinct d.item_code, d.item_name, false, false, 900, null::uuid
from retailcrm_dictionaries d
where d.entity_type = 'status'
  and coalesce(d.item_name, '') <> ''
  and not exists (
      select 1 from crm_statuses s
      where s.code = d.item_code or s.external_code = d.item_code
  )
on conflict (code) do nothing;
