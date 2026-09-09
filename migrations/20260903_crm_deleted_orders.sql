-- Заказы, удалённые в RetailCRM, перестают быть работой.
--
-- Синк только upsert-ит: заказ, удалённый в CRM, оставался у нас навсегда и
-- каждое утро приходил менеджеру как «висит счёт» или «остыл». На 03.09.2026
-- таких призраков было 41 на 14,7 млн ₽ — и это были самые крупные строки плана,
-- потому что удаляют обычно как раз мёртвые крупные сделки.
--
-- Удалять строку у себя нельзя: на неё смотрят зарплата, оценки ОКК и история.
-- Поэтому помечаем, а решает каждый потребитель сам.
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS crm_deleted_at timestamptz,
    ADD COLUMN IF NOT EXISTS crm_checked_at timestamptz;

-- Очередь сверки: кого дольше всех не проверяли.
CREATE INDEX IF NOT EXISTS orders_crm_checked_at_idx
    ON public.orders (crm_checked_at NULLS FIRST);

CREATE INDEX IF NOT EXISTS orders_crm_deleted_at_idx
    ON public.orders (crm_deleted_at)
    WHERE crm_deleted_at IS NOT NULL;

-- План продавца: призраков в нём быть не должно.
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
       AND o.updated_at >= now() - interval '400 days'
       AND o.crm_deleted_at IS NULL;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_presale_orders() TO service_role;

-- Менеджер видит экран ОКК, но карточка заказа в нём отдавала 403: страница и её
-- API — разные строки прав, и в базе они разъехались.
UPDATE public.access_route_rules
   SET allowed_roles = ARRAY['admin', 'okk', 'rop', 'manager', 'demo']::app_role[],
       updated_at = now()
 WHERE prefix = '/api/orders';

-- Сколько раз пробовали завести заказ по письму: транзиентный сбой CRM больше
-- не хоронит заявку молча, но и крутиться вечно она не должна.
ALTER TABLE public.incoming_emails
    ADD COLUMN IF NOT EXISTS order_create_attempts integer NOT NULL DEFAULT 0;
