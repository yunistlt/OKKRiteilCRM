-- Расшифровки звонков по конкретному заказу.
--
-- В комментарии карточки менеджер пишет итог разговора одной строкой, а в
-- расшифровке слышно самого клиента: что именно мешает, чего он ждёт, какими
-- словами это описывает. Для рекомендации по заказу это и есть материал.
CREATE OR REPLACE FUNCTION public.sales_order_calls(p_order_id bigint)
RETURNS TABLE (started_at timestamptz, transcript text)
LANGUAGE sql STABLE AS $function$
    SELECT r.started_at, r.transcript
      FROM public.call_order_matches m
      JOIN public.raw_telphin_calls r ON r.telphin_call_id = m.telphin_call_id
     WHERE m.retailcrm_order_id = p_order_id
       AND r.transcript IS NOT NULL
       AND length(r.transcript) > 200
     ORDER BY r.started_at DESC
     LIMIT 3;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_order_calls(bigint) TO service_role;
