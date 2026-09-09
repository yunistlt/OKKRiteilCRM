-- Срез рабочего дня по звонкам.
--
-- Источник — retailcrm_calls: в нём звонок уже связан с менеджером самой CRM,
-- и это надёжнее нашего сопоставления по номеру. Добавочные у менеджеров в
-- managers.telphin_extension не заполнены, так что другого пути и нет.
--
-- Разговором считаем звонок длиннее 20 секунд: короче — это гудки, автоответчик
-- или «перезвоните позже», и мешать их с разговорами значит завышать работу.
CREATE OR REPLACE FUNCTION public.sales_rop_call_day(p_date date)
RETURNS TABLE (
    manager_id text,
    manager_name text,
    calls_total bigint,
    talks bigint,
    outgoing bigint,
    incoming bigint,
    missed bigint,
    talk_minutes numeric,
    first_call timestamptz,
    last_call timestamptz
)
LANGUAGE sql STABLE AS $function$
    SELECT c.manager_rc_id,
           max(c.manager_name)::text,
           count(*),
           count(*) FILTER (WHERE c.duration_sec > 20),
           count(*) FILTER (WHERE c.call_type = 'out'),
           count(*) FILTER (WHERE c.call_type = 'in'),
           count(*) FILTER (WHERE c.is_missed),
           round(sum(c.duration_sec) / 60.0, 0),
           min(c.call_date),
           max(c.call_date)
      FROM public.retailcrm_calls c
     WHERE c.call_date >= p_date::timestamptz
       AND c.call_date < (p_date + 1)::timestamptz
       AND c.manager_rc_id IS NOT NULL
     GROUP BY c.manager_rc_id;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_call_day(date) TO service_role;

-- Средние за две недели: без сравнения число звонков ничего не значит.
CREATE OR REPLACE FUNCTION public.sales_rop_call_baseline(p_days int DEFAULT 14)
RETURNS TABLE (manager_id text, avg_calls numeric, avg_talks numeric, avg_minutes numeric)
LANGUAGE sql STABLE AS $function$
    SELECT manager_rc_id,
           round(avg(n), 1), round(avg(t), 1), round(avg(m), 0)
      FROM (
          SELECT manager_rc_id, call_date::date AS d,
                 count(*) n,
                 count(*) FILTER (WHERE duration_sec > 20) t,
                 sum(duration_sec) / 60.0 m
            FROM public.retailcrm_calls
           WHERE call_date >= now() - make_interval(days => p_days)
             AND manager_rc_id IS NOT NULL
             -- Выходные в среднее не берём: они занизят будний норматив.
             AND EXTRACT(ISODOW FROM call_date) <= 5
           GROUP BY manager_rc_id, d
      ) t
     GROUP BY manager_rc_id;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_call_baseline(int) TO service_role;
