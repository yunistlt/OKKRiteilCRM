-- ============================================================================
-- Одно поле для поиска заказа по покупателю вместо семи условий через ИЛИ.
--
-- Жалоба Ксении 07.10.2026: «сильно лагает и замедляет нашу работу».
--
-- Замер на боевой базе: поиск по одному полю — 121 мс, те же данные через ИЛИ
-- по семи полям — 2 061 мс, с точным счётчиком строк — 3 330 мс. Postgres на
-- таком ИЛИ перестаёт пользоваться индексами по каждому полю.
--
-- Поэтому складываем всё, по чему ищут покупателя, в одну строку: название
-- покупателя и контрагента, ФИО, почта, телефоны (как есть и только цифрами —
-- номер набирают по-разному). Поле служебное, производное: источник значений
-- прежний, каждое по-прежнему лежит в своей колонке.
-- ============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS search_text text;

COMMENT ON COLUMN public.orders.search_text IS
    'Служебная строка для поиска по покупателю: название, ФИО, почта, телефоны. Производное от полей заказа, собирается триггером.';

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
        regexp_replace(coalesce(NEW."additionalPhone", ''), '\D', '', 'g')
    ));
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'orders_fill_search_text (заказ %): %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

-- Срабатывает ПОСЛЕ orders_fill_names (по алфавиту: names < search_text),
-- чтобы названия уже были проставлены.
DROP TRIGGER IF EXISTS orders_fill_search_text ON public.orders;
CREATE TRIGGER orders_fill_search_text
    BEFORE INSERT OR UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.orders_fill_search_text();

CREATE INDEX IF NOT EXISTS orders_search_text_trgm ON public.orders USING gin (search_text gin_trgm_ops);
