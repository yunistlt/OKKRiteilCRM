-- ============================================================================
-- Номер карточки клиента — своим полем, а не чтением снимка на каждый поиск.
--
-- Жалоба Ксении 07.10.2026: «настройте поиск клиента по почте, заявка новая
-- пришла, не найти». Данные были на месте (orders.search_text содержит почту),
-- не работал сам запрос: к условию поиска добавлялось чтение снимка
-- `raw_payload->customer->>id`, то есть разбор JSON в каждой из 31 тысячи
-- строк без индекса. Замер 07.10.2026: с этим условием запрос не укладывается
-- в таймаут PostgREST («canceling statement due to statement timeout»), и
-- менеджер видит «под этот фильтр заказов нет» вместо найденных заказов.
--
-- Колонка `orders.client_id` для этого уже есть (и индекс idx_orders_client_id
-- тоже), но её никто не заполнял — ни синхронизация, ни своя CRM. Заполняем
-- триггером, как search_text и items_text: поле производное, источник прежний.
--
-- Зарплата читает COALESCE(снимок, client_id) — приоритет у снимка, поэтому
-- заполнение той же величиной расчёт не меняет.
-- ============================================================================

COMMENT ON COLUMN public.orders.client_id IS
    'Номер карточки клиента. Производное от customer/raw_payload->customer->id, собирается триггером; по нему ищут заказы клиента.';

CREATE OR REPLACE FUNCTION public.orders_fill_client_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v text;
BEGIN
    v := COALESCE(
        NEW.customer->>'id',
        NEW.raw_payload->'customer'->>'id'
    );
    IF v ~ '^[0-9]+$' THEN
        NEW.client_id := v::bigint;
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'orders_fill_client_id (заказ %): %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS orders_fill_client_id ON public.orders;
CREATE TRIGGER orders_fill_client_id
    BEFORE INSERT OR UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.orders_fill_client_id();
