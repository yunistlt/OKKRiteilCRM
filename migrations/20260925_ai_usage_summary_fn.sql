-- Свод расходов по ai_usage_events одним запросом.
--
-- Зачем: REST-клиент Supabase отдаёт максимум 1000 строк, а вызовов в сутки тысячи —
-- суммирование на стороне приложения молча занижало расход. Считаем в БД.
create or replace function ai_usage_summary(since timestamptz)
returns table (calls bigint, usd numeric)
language sql
stable
as $$
    select count(*)::bigint as calls, coalesce(sum(cost_usd), 0)::numeric as usd
    from ai_usage_events
    where created_at >= since;
$$;

-- Расход по дням. Нужен, чтобы средняя за неделю не искажалась днями простоя:
-- сутки, в которые ИИ вообще не звали (кончились деньги, встал пайплайн), —
-- это не «дёшево», а «не работало», и в среднюю их брать нельзя.
create or replace function ai_usage_daily(since timestamptz)
returns table (day date, calls bigint, usd numeric)
language sql
stable
as $$
    select created_at::date as day,
           count(*)::bigint as calls,
           coalesce(sum(cost_usd), 0)::numeric as usd
    from ai_usage_events
    where created_at >= since
    group by 1
    order by 1;
$$;
