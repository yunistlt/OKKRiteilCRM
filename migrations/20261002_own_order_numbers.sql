-- Номера своих заказов: 1039А → 900039.
--
-- Кириллическая «А» в номере мешала: ломала ссылки на карточку, пути в
-- хранилище файлов и поиск. Новый формат — шесть знаков с девяткой в начале,
-- на разряд длиннее номеров RetailCRM, поэтому свой заказ виден сразу
-- (решение владельца 02.10.2026).
--
-- Переименовываем вместе со всеми, кто ссылается на номер: файлы, письма,
-- черновики, журнал обзвона. Темы уже отправленных писем не трогаем — это
-- история переписки, там номер должен остаться прежним.
--
-- Правило: «10NN А» → 900000 + NN.

BEGIN;

CREATE TEMP TABLE own_number_map ON COMMIT DROP AS
SELECT
    number AS old_number,
    (900000 + (substring(number from '^10([0-9]{2})А$'))::int)::text AS new_number
FROM public.orders
WHERE number ~ '^10[0-9]{2}А$';

UPDATE public.orders o
SET number = m.new_number
FROM own_number_map m
WHERE o.number = m.old_number;

UPDATE public.order_files f
SET order_number = m.new_number
FROM own_number_map m
WHERE f.order_number = m.old_number;

UPDATE public.order_email_sends s
SET order_number = m.new_number
FROM own_number_map m
WHERE s.order_number = m.old_number;

UPDATE public.order_email_drafts d
SET order_number = m.new_number
FROM own_number_map m
WHERE d.order_number = m.old_number;

UPDATE public.incoming_emails e
SET created_crm_order_number = m.new_number
FROM own_number_map m
WHERE e.created_crm_order_number = m.old_number;

UPDATE public.rop_outreach_log l
SET order_number = m.new_number
FROM own_number_map m
WHERE l.order_number = m.old_number;

-- Номер лежит ещё и внутри самого заказа — карточка читает его оттуда.
UPDATE public.orders o
SET raw_payload = jsonb_set(o.raw_payload, '{number}', to_jsonb(o.number))
WHERE o.is_own AND o.raw_payload ? 'number' AND o.raw_payload->>'number' <> o.number;

COMMIT;
