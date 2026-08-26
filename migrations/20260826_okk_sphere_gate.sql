-- Не заставляем выяснять деятельность компании повторно.
--
-- Критерий «Выяснена деятельность компании» применяется только к клиентам, чья сфера ещё
-- не известна: ни в карточке клиента (поле CRM «Сфера деятельности», создано 2026-08-26
-- у сущностей customer и customer_corporate), ни по прошлым заказам этого юрлица (по ИНН).
-- Значение справочника «Требуется уточнить» известной сферой не считается.
--
-- na_gate теперь допускает НЕСКОЛЬКО кодов через запятую — правило применяется, только когда
-- пройдены все (lib/okk-evaluator.ts).
--
-- Применять ТОЛЬКО ПОСЛЕ деплоя кода с гейтом client_sphere_unknown.

UPDATE public.okk_criteria
SET na_gate = 'production_or_cancel,client_sphere_unknown',
    how_tip = 'Выяснить сферу деятельности клиента и занести её в карточку клиента. У постоянных клиентов, чья сфера уже известна, правило не применяется.',
    updated_at = now()
WHERE key = 'script_company_info';

COMMENT ON COLUMN public.okk_criteria.na_gate IS
    'Коды системных гейтов применимости через запятую (все должны быть пройдены): approval_status | production_or_cancel | client_sphere_unknown | NULL (всегда применяется)';

-- Поиск прошлых заказов клиента по ИНН — иначе проверка сферы делает seq scan по orders.
CREATE INDEX IF NOT EXISTS idx_orders_contragent_inn
    ON public.orders ((raw_payload->'contragent'->>'INN'));
