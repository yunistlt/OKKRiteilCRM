-- ============================================================================
-- Поиск заказов по наименованию товара.
--
-- Просьба Евгении Матвеевой 06.10.2026: «пришёл запрос на стеллаж на 45 пар
-- обуви, только что у меня был подобный запрос. Как найти этот дубль по новой
-- СРМ? Добавьте, пожалуйста, НАИМЕНОВАНИЕ ТОВАРА». Колонка в списке заказов
-- есть, а фильтра не было — дубль по товару найти было нечем.
--
-- Почему колонка, а не поиск по составу на лету: состав лежит отдельной
-- таблицей, и «стеллаж» встречается в 4574 заказах — списком их номеров
-- фильтр не передать. Держим названия позиций строкой рядом с заказом и ищем
-- по ней обычным сравнением.
--
-- Колонка добавочная, существующие не трогаем. Заполняется триггером из того
-- же `raw_payload`, из которого собирается и состав, — отдельного источника
-- правды не заводим.
-- ============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS items_text text;

COMMENT ON COLUMN public.orders.items_text IS
    'Названия позиций заказа одной строкой — для поиска заказов по товару (просьба Евгении Матвеевой 06.10.2026). Заполняется триггером из raw_payload.';

CREATE OR REPLACE FUNCTION public.orders_fill_items_text()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.raw_payload IS NULL OR jsonb_typeof(NEW.raw_payload->'items') <> 'array' THEN
        RETURN NEW;
    END IF;

    SELECT nullif(string_agg(DISTINCT nm, ' | '), '')
      INTO NEW.items_text
      FROM (
        SELECT trim(coalesce(el->'offer'->>'name', el->>'productName', el->>'name', '')) AS nm
          FROM jsonb_array_elements(NEW.raw_payload->'items') el
      ) t
     WHERE nm <> '';

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Поиск по товару — удобство; из-за него заказ сохраняться не перестанет.
    RAISE WARNING 'orders_fill_items_text (заказ %): %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS orders_fill_items_text ON public.orders;
CREATE TRIGGER orders_fill_items_text
    BEFORE INSERT OR UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.orders_fill_items_text();

-- Поиск идёт по куску названия («стеллаж»), поэтому обычный индекс не помогает.
CREATE INDEX IF NOT EXISTS orders_items_text_trgm
    ON public.orders USING gin (items_text gin_trgm_ops);
