-- Разбивка звонков по тому, чем они были на самом деле.
--
-- Раньше разговором считался любой звонок длиннее двадцати секунд, и минутное
-- прослушивание автоответчика попадало в норму. Теперь классификация идёт по
-- расшифровке, поэтому SQL отдаёт и текст: решение принимает код, а не длина.
CREATE OR REPLACE FUNCTION public.sales_rop_call_day(p_date date)
RETURNS TABLE (
    manager_id text, manager_name text,
    calls_total bigint, talks bigint, outgoing bigint, incoming bigint, missed bigint,
    talk_minutes numeric, first_call timestamptz, last_call timestamptz
)
LANGUAGE sql STABLE AS $function$
    SELECT c.manager_rc_id,
           max(c.manager_name)::text,
           count(*),
           -- Оставлено для совместимости: настоящий счёт разговоров считает код
           -- по расшифровкам, здесь только грубая оценка по длительности.
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
