-- Вечерний отчёт владельцу.
--
-- Отдельно от менеджерского: владельцу нужен отдел целиком и то, что требует
-- его решения, а не подсказки по конкретным заказам. Поимённо — потому что
-- «отдел сделал 60 %» не говорит, с кем разговаривать.
INSERT INTO public.sales_rop_settings (key, value, comment) VALUES
    ('owner_chat_id', '682234108', 'Личный чат владельца для вечернего отчёта по отделу'),
    ('owner_report', 'true', 'Слать ли владельцу вечерний отчёт')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, comment = EXCLUDED.comment;

-- Что требует внимания: висящие счета и просроченные обещания.
CREATE OR REPLACE FUNCTION public.sales_rop_attention()
RETURNS TABLE (stale_invoices bigint, overdue_contacts bigint, overdue_amount numeric)
LANGUAGE sql STABLE AS $function$
    SELECT
        (SELECT count(*) FROM public.orders o
          JOIN public.status_settings ss ON ss.code = o.status AND ss.is_working
         WHERE o.status = 'prepayed' AND o.updated_at < now() - interval '2 days'),
        (SELECT count(*) FROM public.orders o
          JOIN public.status_settings ss ON ss.code = o.status AND ss.is_working
         WHERE (o.raw_payload->'customFields'->>'data_kontakta') <> ''
           AND (o.raw_payload->'customFields'->>'data_kontakta')::date < current_date
           AND (o.raw_payload->'customFields'->>'data_kontakta')::date >= current_date - 30
           AND coalesce(o.totalsumm, 0) > 0),
        (SELECT coalesce(sum(o.totalsumm), 0) FROM public.orders o
          JOIN public.status_settings ss ON ss.code = o.status AND ss.is_working
         WHERE (o.raw_payload->'customFields'->>'data_kontakta') <> ''
           AND (o.raw_payload->'customFields'->>'data_kontakta')::date < current_date
           AND (o.raw_payload->'customFields'->>'data_kontakta')::date >= current_date - 30
           AND coalesce(o.totalsumm, 0) > 0);
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_attention() TO service_role;
