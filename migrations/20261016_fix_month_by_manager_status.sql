-- Факт месяца по менеджерам падал на одной записи из 138 тысяч.
--
-- Функция считала, что статус в истории всегда записан как JSON, и делала
-- new_value::jsonb->>'code'. Но в order_history_log статус хранится двумя
-- способами: {"code":"..."} (117 253 записи) и простой строкой (12 324, из них
-- одна — «otlozeno»). На этой одной записи приведение к jsonb падало с ошибкой
-- «invalid input syntax for type json», и расчёт валился целиком — у ВСЕХ
-- менеджеров разом.
--
-- Падало молча: маршрут «Моего дня» ошибку RPC не проверяет и подставляет ноль,
-- поэтому план месяца у людей просто показывался нулевым (найдено 16.10.2026).
--
-- Код на TypeScript оба формата учитывает давно (lib/sales-rop/service.ts),
-- функция в базе — нет. Выравниваем: разбираем JSON только когда это JSON,
-- иначе берём саму строку как код.

CREATE OR REPLACE FUNCTION public.sales_rop_status_code(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        -- {"code":"send-assembling"} — обычная запись синхронизации.
        WHEN left(btrim(p_value), 1) = '{' THEN btrim(p_value)::jsonb->>'code'
        -- "send-assembling" — код, записанный строкой JSON.
        WHEN left(btrim(p_value), 1) = '"' THEN btrim(btrim(p_value), '"')
        -- send-assembling — код как есть. Сюда же попадают «null» и русские
        -- названия статусов: ни то, ни другое ни с чем не совпадёт, и строка
        -- просто не попадёт в выборку.
        ELSE btrim(p_value)
    END;
$$;

CREATE OR REPLACE FUNCTION public.sales_rop_month_by_manager(p_date date)
RETURNS TABLE(manager_id bigint, sold_count bigint, sold_sum numeric)
LANGUAGE sql
STABLE
AS $function$
    WITH sales AS (
        SELECT retailcrm_order_id, min(occurred_at) at
          FROM public.order_history_log
         WHERE field = 'status'
           AND public.sales_rop_status_code(new_value) IN ('send-assembling', 'zagruzen-systemu')
         GROUP BY 1
    ),
    month_sales AS (
        SELECT * FROM sales
         WHERE at >= date_trunc('month', p_date::timestamptz)
           AND at < (date_trunc('month', p_date::timestamptz) + interval '1 month')
    )
    SELECT o.manager_id,
           count(*),
           coalesce(sum(public.salary_revenue_no_vat(o.raw_payload->'items', o.site,
                                                     o.raw_payload->'contragent', p_date)), 0)
      FROM month_sales m
      JOIN public.orders o ON o.order_id = m.retailcrm_order_id
     WHERE o.manager_id IS NOT NULL
     GROUP BY o.manager_id;
$function$;
