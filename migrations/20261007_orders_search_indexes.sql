-- ============================================================================
-- Поиск заказов по покупателю: индексы и столбец названия клиента.
--
-- Жалоба Ксении 07.10.2026: «не ищет по наименованию организации… фильтр
-- поиска что по номеру, что по наименованию или по телефону работает
-- отвратительно, по 10–15 раз нажимать приходится, сильно лагает и замедляет
-- нашу работу».
--
-- Это моя регрессия от 06.10.2026. Расширяя поиск, я добавил в условие чтение
-- снимка заказа: `raw_payload->>'firstName'`, `->'customer'->>'nickName'`,
-- `->'contragent'->>'legalName'`. По 30 тысячам заказов это разбор JSON в
-- каждой строке без единого индекса — запрос не укладывался в таймаут, и
-- менеджер видел «Под этот фильтр заказов нет» вместо найденного заказа
-- (пример: «СИрС», заказ 54776).
--
-- Лечим по закону «у каждого значения своё поле»: ищем по текстовым колонкам,
-- а не по снимку, и на каждой держим индекс для поиска по куску слова.
--
-- Название клиента и контрагента текстовыми колонками не лежало — заводим:
-- customer и contragent хранятся как jsonb, искать по ним нельзя.
-- ============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS contragent_name text;

COMMENT ON COLUMN public.orders.customer_name IS
    'Название покупателя одной строкой — для поиска (из customer.nickName / ФИО).';
COMMENT ON COLUMN public.orders.contragent_name IS
    'Юридическое название контрагента — для поиска (из contragent.legalName).';

CREATE OR REPLACE FUNCTION public.orders_fill_names()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.customer_name := nullif(trim(coalesce(
        NEW."customer"->>'nickName',
        nullif(trim(concat_ws(' ', NEW."customer"->>'firstName', NEW."customer"->>'lastName')), ''),
        nullif(trim(concat_ws(' ', NEW."firstName", NEW."lastName")), '')
    )), '');
    NEW.contragent_name := nullif(trim(coalesce(NEW."contragent"->>'legalName', '')), '');
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'orders_fill_names (заказ %): %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS orders_fill_names ON public.orders;
CREATE TRIGGER orders_fill_names
    BEFORE INSERT OR UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.orders_fill_names();

-- Поиск идёт по куску слова, поэтому обычный индекс не помогает.
CREATE INDEX IF NOT EXISTS orders_customer_name_trgm ON public.orders USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS orders_contragent_name_trgm ON public.orders USING gin (contragent_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS orders_first_name_trgm ON public.orders USING gin ("firstName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS orders_last_name_trgm ON public.orders USING gin ("lastName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS orders_email_trgm ON public.orders USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS orders_number_trgm ON public.orders USING gin (number gin_trgm_ops);
