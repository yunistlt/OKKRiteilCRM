-- Кто говорил и чей это заказ — разные вещи. Плюс склейка ног очереди.
--
-- Инцидент 02.09.2026, заказ 54494. Обратный звонок с сайта идёт через очередь
-- 200, где 105/119/120 звонят ОДНОВРЕМЕННО. Телфин пишет каждую ногу отдельной
-- записью — с разными record_uuid и даже разными аккаунтами:
--   10:24 исходящий 105 Парфёнова  139 сек  answered
--   10:24 входящий  119 Матвеева   147 сек  answered
--   18:18 исходящий 120 Гордеева     0 сек  failed
-- Один разговор с клиенткой Еленой достался в отчёт двум менеджерам сразу, а
-- заказ при этом на третьей — на Гордеевой. Менеджер справедливо не узнала свой
-- день: «я есть в разговоре как менеджер, а заказ на Ирине».
--
-- Склеиваем ноги: один и тот же телефон в пределах двух минут — это один
-- разговор. Оставляем ту ногу, где дольше говорили: именно там записан диалог,
-- остальные — дозвон. Дедуп по record_uuid не работает, одинаковых uuid нет.
--
-- И отдаём менеджера заказа отдельной колонкой: звонить по чужому заказу
-- нормально (замена, отпуск, клиент набрал напрямую) — расходится в 536 случаях
-- из 2062 с 01.08. Поэтому не подменяем одно другим, а показываем оба.
-- Набор колонок меняется, поэтому пересоздаём. Оба стейтмента идут одной
-- транзакцией — момента, когда функции нет, для прода не существует.
DROP FUNCTION IF EXISTS public.sales_rop_day_calls(date, text);

CREATE FUNCTION public.sales_rop_day_calls(p_date date, p_manager text)
RETURNS TABLE (
    call_at timestamptz,
    direction text,
    duration_sec int,
    phone text,
    order_number text,
    order_manager_name text,
    transcript text
)
LANGUAGE sql STABLE AS $function$
    WITH day_calls AS (
        SELECT c.*
          FROM public.retailcrm_calls c
         WHERE c.call_date >= p_date::timestamptz
           AND c.call_date < (p_date + 1)::timestamptz
    ),
    -- Ноги одного дозвона: тот же клиент, разница во времени меньше двух минут.
    -- Группа считается по первому звонку в связке.
    legs AS (
        SELECT d.*,
               (SELECT min(x.call_date) FROM day_calls x
                 WHERE x.phone_normalized IS NOT DISTINCT FROM d.phone_normalized
                   AND abs(extract(epoch FROM (x.call_date - d.call_date))) <= 120) AS leg_group
          FROM day_calls d
    ),
    -- Победитель связки — самый длинный разговор. При равенстве берём меньший
    -- rc_call_id, чтобы результат не плавал между прогонами.
    winners AS (
        SELECT DISTINCT ON (phone_normalized, leg_group) *
          FROM legs
         ORDER BY phone_normalized, leg_group, duration_sec DESC, rc_call_id
    )
    SELECT w.call_date,
           CASE w.call_type WHEN 'out' THEN 'исходящий' ELSE 'входящий' END,
           w.duration_sec,
           w.phone_normalized,
           w.order_number,
           nullif(trim(concat_ws(' ', m.last_name, m.first_name)), ''),
           left(t.transcript, 1500)
      FROM winners w
      LEFT JOIN public.orders o ON o.number = w.order_number
      LEFT JOIN public.managers m ON m.id = o.manager_id
      LEFT JOIN public.raw_telphin_calls t
        ON t.started_at >= (p_date - 1)::timestamptz
       AND t.started_at <  (p_date + 2)::timestamptz
       AND EXISTS (
            SELECT 1 FROM unnest(t.record_uuids) u
             WHERE lower(u) LIKE '%' || lower(w.record_uuid) || '%'
        )
     WHERE w.manager_rc_id = p_manager
     ORDER BY w.call_date;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_day_calls(date, text) TO service_role;
