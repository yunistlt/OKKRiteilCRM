-- Срез по звонкам — только отдел продаж.
--
-- Владелец 05.11.2026: «Симонова не менеджер, мы считаем только наших трёх».
-- После переезда отчёта на свои звонки в срез попадал каждый, у кого есть
-- добавочный Телфина и были звонки, — за 30 дней это четыре человека:
-- Матвеева 780, Гордеева 740, Парфенова 526 и Симонова 134 звонка.
--
-- Признак «кто в ОП» в проекте один и он ручной: отметка в настройках ОКК
-- (`/settings/managers` → таблица `salary_participant`), по ней же считается
-- зарплата. Группы пользователей RetailCRM для этого не годятся — у троих
-- настоящих менеджеров там стоит «Тестовый доступ без права редактирования», а
-- у Симоновой как раз «Менеджеры ОП»: по группам отобрались бы ровно не те.
--
-- Фильтр ставится ТОЛЬКО на отчёты отдела (`sales_rop_call_day` и норма
-- `sales_rop_call_baseline`). `own_calls_for_period`, `sales_rop_day_calls` и
-- «Мой день» остаются без него: реестр звонков и свой день должны работать у
-- любого сотрудника с добавочным, а не только у участников зарплаты.

CREATE OR REPLACE FUNCTION public.sales_rop_call_day(p_date date)
RETURNS TABLE(
    manager_id text, manager_name text, calls_total bigint, talks bigint,
    outgoing bigint, incoming bigint, missed bigint, talk_minutes numeric,
    first_call timestamp with time zone, last_call timestamp with time zone
)
LANGUAGE sql
STABLE
AS $function$
    SELECT c.manager_id::text,
           max(c.manager_name)::text,
           count(*),
           -- Разговор — тот, где дозвонились (`call_answered`). Прежняя оценка
           -- «дольше 20 секунд» считала минуту автоответчика работой. Вечерний
           -- отчёт поверх этого считает разговоры по расшифровкам — это
           -- оценка на день, пока расшифровок ещё нет.
           count(*) FILTER (WHERE c.answered),
           count(*) FILTER (WHERE c.direction = 'outgoing'),
           count(*) FILTER (WHERE c.direction = 'incoming'),
           count(*) FILTER (WHERE NOT c.answered),
           round(sum(c.duration_sec) / 60.0, 0),
           min(c.started_at),
           max(c.started_at)
      FROM public.own_calls_for_period(p_date::timestamptz, (p_date + 1)::timestamptz) c
     WHERE c.manager_id IS NOT NULL
       -- Отдел продаж — по отметке в настройках ОКК, пофамильно.
       AND EXISTS (SELECT 1 FROM public.salary_participant sp WHERE sp.manager_id = c.manager_id)
     GROUP BY c.manager_id;
$function$;

CREATE OR REPLACE FUNCTION public.sales_rop_call_baseline(p_days integer DEFAULT 14)
RETURNS TABLE(manager_id text, avg_calls numeric, avg_talks numeric, avg_minutes numeric)
LANGUAGE sql
STABLE
AS $function$
    SELECT manager_id::text,
           round(avg(n), 1), round(avg(t), 1), round(avg(m), 0)
      FROM (
          SELECT c.manager_id,
                 (c.started_at AT TIME ZONE 'Europe/Moscow')::date AS d,
                 count(*) n,
                 count(*) FILTER (WHERE c.answered) t,
                 sum(c.duration_sec) / 60.0 m
            FROM public.own_calls_for_period(
                     (now() - make_interval(days => p_days))::timestamptz,
                     now()
                 ) c
           WHERE c.manager_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.salary_participant sp WHERE sp.manager_id = c.manager_id)
             -- Выходные в среднее не берём: они занизят будний норматив.
             AND EXTRACT(ISODOW FROM c.started_at AT TIME ZONE 'Europe/Moscow') <= 5
           GROUP BY c.manager_id, d
      ) t
     GROUP BY manager_id;
$function$;
