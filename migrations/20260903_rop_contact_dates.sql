-- Срез по датам следующего контакта для вечерней сводки.
--
-- Дату контакта используют как служебную галочку: 03.09.2026 у одного менеджера
-- на сегодня стояло 87 заказов, все — перенос уже стоявшей даты, самый старый
-- сдвиг на 702 дня. Пока это видно только в базе, ничего не изменится; вечером
-- человек должен видеть, что он сегодня сделал с обещаниями.
--
-- Считаем по каждому менеджеру за день:
--   moved_today  — сколько дат он сегодня подвинул (правки в истории заказа);
--   moved_by_day — из них перенос ровно на завтра (та самая пачка);
--   overdue      — обещаний с прошедшей датой, ещё не закрытых;
--   peak_date/peak_count — самый нагруженный день впереди.
CREATE OR REPLACE FUNCTION public.sales_rop_contact_dates(p_date date)
RETURNS TABLE (
    manager_id bigint,
    moved_today integer,
    moved_by_day integer,
    overdue integer,
    peak_date date,
    peak_count integer
)
LANGUAGE sql STABLE AS $function$
    WITH working AS (
        SELECT o.order_id, o.manager_id,
               nullif(o.raw_payload->'customFields'->>'data_kontakta', '')::date AS contact_date
          FROM public.orders o
          JOIN public.status_settings ss ON ss.code = o.status AND ss.is_working
         WHERE o.crm_deleted_at IS NULL
           AND coalesce(o.totalsumm, 0) > 0
    ),
    moves AS (
        -- Правки даты, сделанные сегодня самим менеджером. Записи без пользователя —
        -- это наш бот, его переносы человеку не в упрёк.
        SELECT (h.user_data->>'id')::bigint AS manager_id,
               count(*)::int AS moved_today,
               count(*) FILTER (
                   WHERE h.new_value::date = p_date + 1
               )::int AS moved_by_day
          FROM public.order_history_log h
         WHERE h.field = 'custom_data_kontakta'
           AND h.occurred_at >= p_date::timestamptz
           AND h.occurred_at < (p_date + 1)::timestamptz
           AND h.user_data->>'id' IS NOT NULL
           AND h.new_value ~ '^\d{4}-\d{2}-\d{2}'
         GROUP BY 1
    ),
    overdue AS (
        SELECT w.manager_id, count(*)::int AS overdue
          FROM working w
         WHERE w.contact_date IS NOT NULL AND w.contact_date < p_date
         GROUP BY 1
    ),
    peak AS (
        SELECT DISTINCT ON (w.manager_id)
               w.manager_id, w.contact_date AS peak_date, count(*)::int AS peak_count
          FROM working w
         WHERE w.contact_date IS NOT NULL AND w.contact_date >= p_date
         GROUP BY w.manager_id, w.contact_date
         ORDER BY w.manager_id, count(*) DESC, w.contact_date
    )
    SELECT m.id,
           coalesce(mv.moved_today, 0),
           coalesce(mv.moved_by_day, 0),
           coalesce(od.overdue, 0),
           pk.peak_date,
           coalesce(pk.peak_count, 0)
      FROM public.managers m
      LEFT JOIN moves mv ON mv.manager_id = m.id
      LEFT JOIN overdue od ON od.manager_id = m.id
      LEFT JOIN peak pk ON pk.manager_id = m.id
     WHERE coalesce(m.active, false);
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_contact_dates(date) TO service_role;
