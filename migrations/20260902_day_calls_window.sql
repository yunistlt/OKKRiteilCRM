-- Ускорение sales_rop_day_calls: искать расшифровку только в окне того же дня.
--
-- Джойн по «uuid внутри строки» нельзя проиндексировать, поэтому на каждый
-- звонок перебиралась вся raw_telphin_calls (54 тыс. строк и растёт). 02.09.2026
-- вечерний отчёт впервые упёрся в лимит 8 с и не ушёл вовсе: у одного менеджера
-- запрос занимал 6,4 с, а под нагрузкой прода — больше.
--
-- Расшифровка звонка лежит в записи того же звонка, так что смотреть дальше
-- соседних суток незачем. Окно ±1 день закрывает расхождение часовых поясов и
-- звонки за полночь. Результат совпадает со старой версией строка в строку,
-- время — 6,4 с → 0,13 с.
CREATE OR REPLACE FUNCTION public.sales_rop_day_calls(p_date date, p_manager text)
RETURNS TABLE (
    call_at timestamptz,
    direction text,
    duration_sec int,
    phone text,
    order_number text,
    transcript text
)
LANGUAGE sql STABLE AS $function$
    SELECT c.call_date,
           CASE c.call_type WHEN 'out' THEN 'исходящий' ELSE 'входящий' END,
           c.duration_sec,
           c.phone_normalized,
           c.order_number,
           left(t.transcript, 1500)
      FROM public.retailcrm_calls c
      LEFT JOIN public.raw_telphin_calls t
        ON t.started_at >= (p_date - 1)::timestamptz
       AND t.started_at <  (p_date + 2)::timestamptz
       AND EXISTS (
            SELECT 1 FROM unnest(t.record_uuids) u
             WHERE lower(u) LIKE '%' || lower(c.record_uuid) || '%'
        )
     WHERE c.call_date >= p_date::timestamptz
       AND c.call_date < (p_date + 1)::timestamptz
       AND c.manager_rc_id = p_manager
     ORDER BY c.call_date;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_day_calls(date, text) TO service_role;

-- Индекс по времени звонка: без него окно всё равно читается сканом.
CREATE INDEX IF NOT EXISTS idx_raw_telphin_calls_started_at
    ON public.raw_telphin_calls (started_at);
