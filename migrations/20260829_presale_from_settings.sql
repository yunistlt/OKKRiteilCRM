-- Рабочие статусы берём из разметки, а не из списка в коде.
--
-- Разметку ведёт человек в настройках ОКК, и она меняется: сегодня
-- «Согласование отмены» убрали из рабочих, завтра появится новый статус.
-- Список в коде это переживёт ровно до первого изменения, о котором мне не
-- скажут.
DROP FUNCTION IF EXISTS public.sales_rop_presale_orders() CASCADE;
CREATE OR REPLACE FUNCTION public.sales_rop_presale_orders()
RETURNS TABLE (
    order_id bigint, number text, client text, status_code text, status_name text,
    amount numeric, manager_id bigint, manager_name text, telegram_username text,
    contact_date date, last_touch_at timestamptz, site text, manager_active boolean
)
LANGUAGE sql STABLE AS $function$
    SELECT o.order_id, o.number::text,
           coalesce(o.raw_payload->'customer'->>'nickName', '')::text,
           o.status::text, coalesce(s.name, o.status)::text,
           coalesce(o.totalsumm, 0), o.manager_id,
           trim(coalesce(m.last_name, '') || ' ' || coalesce(m.first_name, ''))::text,
           coalesce(m.raw_data->>'telegram_username', '')::text,
           nullif(o.raw_payload->'customFields'->>'data_kontakta', '')::date,
           GREATEST(
               o.updated_at,
               coalesce((SELECT max(h.occurred_at) FROM public.order_history_log h
                          WHERE h.retailcrm_order_id = o.order_id), o.updated_at)
           ),
           coalesce(o.site, o.raw_payload->>'site', '')::text,
           coalesce(m.active, false)
      FROM public.orders o
      JOIN public.statuses s ON s.code = o.status
      -- Вот источник правды: разметка «в работе» из настроек ОКК.
      JOIN public.status_settings ss ON ss.code = o.status AND ss.is_working
      LEFT JOIN public.managers m ON m.id = o.manager_id
     WHERE coalesce(o.totalsumm, 0) > 0
       AND o.updated_at >= now() - interval '400 days';
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_presale_orders() TO service_role;

INSERT INTO public.sales_rop_settings (key, value, comment) VALUES
    ('fresh_overdue_days', '30', 'До скольких дней просрочка считается свежей и идёт в дневной план'),
    ('cold_per_day', '2', 'Сколько остывших заказов давать сверх плана')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, comment = EXCLUDED.comment;

DELETE FROM public.sales_rop_settings WHERE key IN ('overdue_limit_days', 'lost_per_day');
