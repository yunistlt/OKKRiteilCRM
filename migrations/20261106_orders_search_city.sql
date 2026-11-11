-- Поиск заказов по городу и адресу доставки.
--
-- Жалоба Ирины Гордеевой 05.11.2026 (доработка 79): «Не ищет поиск по городу».
-- В search_text лежали только имя, контрагент, почта, телефоны и ИНН — адреса
-- там не было вовсе, поэтому по городу не находилось НИЧЕГО.
--
-- Город менеджеры ведут в двух местах, и в поиск идут оба:
--  1. кастом-поле «Город доставки (менеджерам ОП)»
--     (raw_payload->'customFields'->>'gorod_dostavki_menedzheram_op') — его
--     заполняют чаще и ищут прежде всего по нему;
--  2. адрес доставки orders.delivery->'address' ({text, region, city, index}),
--     куда пишет правка заказа (lib/own-crm/own-orders.ts).
--
-- Старые строки эта миграция не трогает: массовый UPDATE по 38 тыс. заказов в
-- рабочее время кладёт отдел (закон о слабом диске, авария 16.10.2026).
-- Заполнение задним числом — scripts/backfill-orders-search-city.js, порциями
-- и вечером.

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
        NEW.contragent->>'OGRN',
        -- Город, который ведут САМИ менеджеры: кастом-поле «Город доставки
        -- (менеджерам ОП)». Его заполняют чаще адреса доставки (517 заказов
        -- против 383 за 90 дней) и ищут именно по нему: у заказов 900493 и
        -- 900176 из жалобы адрес пустой, а это поле заполнено.
        NEW.raw_payload->'customFields'->>'gorod_dostavki_menedzheram_op',
        -- Куда везём по адресу доставки: город, регион и адрес строкой.
        NEW.delivery->'address'->>'city',
        NEW.delivery->'address'->>'region',
        NEW.delivery->'address'->>'text',
        NEW.warehouse_address
    ));
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'orders_fill_search_text (заказ %): %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;
