-- Поиск заказа по ИНН.
--
-- Ирина Гордеева 12.10.2026: «можете в поиск добавить по ИНН?». Поиск по ИНН
-- уже был, но только через карточку клиента (clients.inn): если ИНН стоит в
-- самом заказе, а карточка не заполнена, заказ не находился. ИНН есть в
-- снимке у 14 552 заказов.
--
-- Кладём ИНН в ту же поисковую строку, по которой ищет поле «Покупатель»:
-- на неё есть индекс, а чтение JSON в условии запроса валит таймаут (урок
-- 07.10.2026).

CREATE OR REPLACE FUNCTION public.orders_fill_search_text()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.search_text := lower(concat_ws(' ',
        NEW.customer_name,
        NEW.contragent_name,
        NEW."firstName",
        NEW."lastName",
        NEW.email,
        NEW.phone,
        NEW."additionalPhone",
        -- Телефоны только цифрами: «+7 (995) 344-68-62» и «89953446862» —
        -- один и тот же номер.
        regexp_replace(coalesce(NEW.phone, ''), '\D', '', 'g'),
        regexp_replace(coalesce(NEW."additionalPhone", ''), '\D', '', 'g'),
        -- ИНН заказчика: и как записан, и только цифрами.
        NEW.contragent->>'INN',
        regexp_replace(coalesce(NEW.contragent->>'INN', ''), '\D', '', 'g'),
        NEW.contragent->>'KPP',
        NEW.contragent->>'OGRN'
    ));
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'orders_fill_search_text (заказ %): %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

-- Перебираем существующие строки, чтобы ИНН попал в поисковую строку сразу,
-- а не по мере следующей синхронизации.
UPDATE public.orders SET search_text = search_text
 WHERE contragent->>'INN' IS NOT NULL;
