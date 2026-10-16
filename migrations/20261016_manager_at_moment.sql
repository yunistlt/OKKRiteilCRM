-- Кто вёл заказ на заданный момент.
--
-- Зачем. Зарплата и показатели берут дату продажи из истории, а менеджера —
-- текущего из заказа. Значит перевешивание заказа переписывает чужой заработок
-- задним числом: продала Никитина, заказ отдали Гордеевой — и продажа Никитиной
-- засчиталась Гордеевой. На 16.10.2026 так разошлись 15 продаж за год на
-- 3,56 млн ₽, все — сделки уволенной Никитиной Ольги.
--
-- Продажа — свершившийся факт: кто её сделал, тот и сделал. Смена ответственного
-- за клиента не должна этого менять. Эта функция и даёт «менеджера на момент».
--
-- Формат записи. В order_history_log поле manager лежит как {"id": 249} — так
-- пишет синхронизация RetailCRM и, с 16.10.2026, наш код. До этого мы писали
-- туда ФАМИЛИЮ строкой: по ней сопоставлять нельзя (человек сменит фамилию — и
-- история перестанет сходиться), но старые записи уже такие, поэтому для них
-- оставлен запасной разбор по имени. Новых таких записей не появляется.

CREATE OR REPLACE FUNCTION public.history_manager_id(p_value text)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        -- {"id": 249} — единственный правильный формат.
        WHEN left(btrim(p_value), 1) = '{' THEN (btrim(p_value)::jsonb->>'id')::bigint
        -- «Фамилия Имя» — наследие записей до 16.10.2026.
        ELSE (SELECT m.id FROM public.managers m
               WHERE trim(coalesce(m.last_name, '') || ' ' || coalesce(m.first_name, '')) = btrim(p_value)
               LIMIT 1)
    END;
$$;

-- Кто вёл заказ в указанный момент: последняя смена менеджера до него.
-- Смен не было — значит с самого начала ведёт тот, кто стоит в заказе сейчас.
CREATE OR REPLACE FUNCTION public.order_manager_at(p_order_id bigint, p_at timestamptz)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        (SELECT public.history_manager_id(h.new_value)
           FROM public.order_history_log h
          WHERE h.retailcrm_order_id = p_order_id
            AND h.field = 'manager'
            AND h.occurred_at <= p_at
            AND public.history_manager_id(h.new_value) IS NOT NULL
          ORDER BY h.occurred_at DESC
          LIMIT 1),
        (SELECT o.manager_id FROM public.orders o WHERE o.order_id = p_order_id)
    );
$$;
