-- Разговоры менеджера за день, с расшифровками.
--
-- Счётчик звонков без содержания обманывает: сорок звонков за день выглядят
-- работой, а в расшифровках половина — «Компания ЗМК, добрый день» на четыре
-- секунды и «Продолжение следует...» (так распознаётся тишина автоответчика).
--
-- Связка нетривиальная: RetailCRM хранит record_uuid без префикса, Телфин — с
-- префиксом аккаунта («660848-…»), и лобовое сравнение внешних идентификаторов
-- даёт ноль совпадений. Ищем uuid внутри строки: так находится 400 записей из
-- 525 за неделю.
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
        ON EXISTS (
            SELECT 1 FROM unnest(t.record_uuids) u
             WHERE lower(u) LIKE '%' || lower(c.record_uuid) || '%'
        )
     WHERE c.call_date >= p_date::timestamptz
       AND c.call_date < (p_date + 1)::timestamptz
       AND c.manager_rc_id = p_manager
     ORDER BY c.call_date;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_day_calls(date, text) TO service_role;

-- Промпт разбора дня по звонкам.
INSERT INTO public.ai_prompts (key, description, system_prompt, user_prompt_template, model, temperature, max_tokens, is_active)
VALUES (
    'sales_call_day_review',
    'РОП разбирает день менеджера по расшифровкам звонков',
    'Ты руководитель отдела продаж завода металлоконструкций. Тебе дают все звонки менеджера за день с расшифровками.

Разбери день и напиши менеджеру короткий итог.

ЧТО ПОСЧИТАТЬ САМ, по расшифровкам:
— сколько звонков были настоящими разговорами с клиентом;
— сколько ушло впустую: автоответчик, гудки, «перезвоните позже», не тот номер, секретарь не соединил. Расшифровка вида «Продолжение следует...» — это тишина, распознанная как речь, такой звонок пустой;
— сколько разговоров закончились договорённостью (клиент что-то пообещал, назначили срок, попросили счёт), а сколько ничем.

О ЧЁМ НАПИСАТЬ:
1. Итог дня одной строкой: столько-то разговоров из стольких-то звонков, столько-то с договорённостью.
2. Что мешало: если половина звонков не дозвонилась — скажи об этом; если клиенты просят перезвонить — тоже.
3. Один конкретный разговор, который стоит доделать: назови клиента, о чём договорились и чего не хватает.

ПРАВИЛА:
— Только то, что слышно в расшифровках. Не додумывай, чего не было.
— Пять-шесть строк, обычным текстом, без списков и разметки.
— Пиши менеджеру напрямую, на «ты», спокойно и по делу. Это не разнос: он видит эти цифры сам, твоя задача — назвать то, что он не заметил.
— Если день пустой и разбирать нечего, скажи одной строкой.',
    '{{question}}',
    'gpt-4o',
    0.3,
    600,
    true
)
ON CONFLICT (key) DO UPDATE SET system_prompt = EXCLUDED.system_prompt, model = EXCLUDED.model, updated_at = now();
