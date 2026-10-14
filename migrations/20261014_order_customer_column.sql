-- ============================================================================
-- Покупатель заказа — в своём поле, а не в снимке.
--
-- Повод 14.10.2026: страница «Зарплата ОП» перестала открываться — расчёт
-- открытого периода не укладывался в лимит. Виновата
-- `salary_client_purchase_ordinals`: 18 секунд, из них 9 — чтение `orders` по
-- одному заказу ради `raw_payload->'customer'->>'id'`. Снимок заказа весит
-- много, и 8 041 такое чтение стоит дороже всей остальной работы.
--
-- По закону об одном источнике правды рабочее значение берут из поля, а не из
-- снимка. Колонка `customer` у таблицы есть, но триггер переноса её не
-- заполнял (в отличие от соседней `contragent`) — поэтому у 7 409 заказов она
-- пуста, и читать было неоткуда.
--
-- Расхождений нет: там, где `customer` заполнена, она совпадает со снимком до
-- символа; пустые — именно те 7 409. Поэтому дозаполнение пустых ничью правду
-- не затирает.
-- ============================================================================

-- 1. Перенос заполняет покупателя так же, как контрагента.
--    Своё значение не трогаем: триггер работает от снимка, а у своих заказов
--    снимка нет (закон «свой заказ обязан писать orders.customer»).
CREATE OR REPLACE FUNCTION public.orders_fill_customer()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.raw_payload IS NOT NULL AND jsonb_typeof(NEW.raw_payload->'customer') = 'object' THEN
        NEW."customer" := NEW.raw_payload->'customer';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS orders_fill_customer ON public.orders;
CREATE TRIGGER orders_fill_customer
    BEFORE INSERT OR UPDATE OF raw_payload ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.orders_fill_customer();

-- 2. Дозаполняем только ПУСТЫЕ — заполненные совпадают со снимком.
UPDATE public.orders
   SET "customer" = raw_payload->'customer'
 WHERE "customer" IS NULL
   AND jsonb_typeof(raw_payload->'customer') = 'object';

-- 3. Идентификатор покупателя — отдельным числом, чтобы по нему искать и
--    соединять. Это не копия: значение вычисляется из `customer` самой базой.
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS customer_id bigint
    GENERATED ALWAYS AS (NULLIF("customer"->>'id', '')::bigint) STORED;

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders (customer_id);

COMMENT ON COLUMN public.orders.customer_id IS
    'Идентификатор покупателя в RetailCRM. Вычисляется из orders.customer, вручную не пишется.';
