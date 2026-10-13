-- ============================================================================
-- Колонка orders.status берётся из самого заказа.
--
-- Разбор 06.10.2026 (владелец: «проверь, мне кажется слишком завышенная
-- зарплата стала» → «сравни с ритейлом, они же не выполнили план»).
--
-- Что нашли: колонка `status` разошлась с заказом. В `raw_payload` статус
-- правильный, а в колонке застыл старый. Пример: заказ 54665 по истории ушёл
-- в «Дубль заявки», заказ 54301 — в «Предоплата», а в колонке у обоих стояло
-- «Передано в производство». Всего таких заказов 17, из них 9 ошибочно
-- числились переданными в производство.
--
-- Чем это вредило: зарплата считает засчитанные заявки в том числе по колонке
-- `status`. Из-за четырёх таких заказов сентябрь получил лишние ~895 тыс. ₽
-- выручки, план отдела «выполнился» на 100,07 % и всем менеджерам начислился
-- множитель ×1,2. Сверка с RetailCRM: за сентябрь там 43 перехода в
-- производство — ровно столько же, сколько в нашей истории; лишние 4 пришли
-- только из битой колонки.
--
-- Почему разошлось: колонку заполнял перенос из RetailCRM, а триггер
-- `orders_fill_retailcrm_columns` её не трогает — он ставит только
-- `statusComment` и `statusUpdatedAt`. Перенос мы отключили, и колонка
-- перестала обновляться, хотя сам заказ обновляется.
--
-- Теперь колонка всегда равна статусу в заказе. Правка заказа в ОКК пишет оба
-- места одинаково (lib/own-crm/own-orders.ts), так что расхождения не будет.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.orders_status_from_payload()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.raw_payload IS NOT NULL AND nullif(NEW.raw_payload->>'status', '') IS NOT NULL THEN
        NEW.status := NEW.raw_payload->>'status';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS orders_status_from_payload ON public.orders;
CREATE TRIGGER orders_status_from_payload
    BEFORE INSERT OR UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.orders_status_from_payload();

COMMENT ON FUNCTION public.orders_status_from_payload() IS
    'Колонка status = статус в raw_payload. Без этого колонка застывала после отключения переноса из RetailCRM и завышала зарплату (разбор 06.10.2026).';
