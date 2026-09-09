-- Сколько новых заявок в день приходится на менеджера.
--
-- Их надо разобрать в тот же день, и это занимает время раньше любого нашего
-- плана. По факту за месяц: 18 заявок в день на отдел, но распределены
-- неравномерно — 7,3 у одного, 4,3 у другого. Считать среднее по отделу значит
-- одного перегрузить, другого недогрузить.
--
-- Считается по факту, а не задаётся числом в настройке: поток заявок меняется
-- сам по себе, и настройка устареет к следующему сезону.
CREATE OR REPLACE FUNCTION public.sales_rop_daily_intake(p_days int DEFAULT 30)
RETURNS TABLE (manager_id bigint, per_day numeric)
LANGUAGE sql STABLE AS $function$
    SELECT o.manager_id,
           -- Рабочих дней примерно 5/7 от календарных: заявки приходят и в
           -- выходные, а разбирают их в будни.
           round(count(*)::numeric / GREATEST(1, round(p_days * 5.0 / 7)), 1)
      FROM public.orders o
     WHERE o.created_at >= now() - make_interval(days => p_days)
       AND o.manager_id IS NOT NULL
     GROUP BY o.manager_id;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_daily_intake(int) TO service_role;
