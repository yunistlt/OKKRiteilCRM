-- Юрлицо, на которое заводится новый заказ, если менеджер его не выбрал.
--
-- Доработка №95 (Елена Парфёнова 18.11.2026): «сделайте в новом заказе
-- автоматический магазин ПОБТ, раз у нас продажи на ПОБТ сейчас в приоритете».
-- Решение владельца 23.11.2026: не зашивать, а дать переключатель в настройках
-- юрлиц (/settings/legal-entities) — приоритет меняется решением, а не выкаткой.
--
-- Раньше юрлицо по умолчанию было вписано в код (ООО «ЗМК», магазин zmktlt-ru).
-- Миграция переносит это в базу как есть, поведение не меняется, пока владелец
-- не переключит.
--
-- Юрлицо по умолчанию может быть только одно — уникальный индекс по условию.
-- Переключение — одной функцией: снять старое и поставить новое в одной
-- транзакции, иначе между двумя запросами заказ завёлся бы без юрлица.

ALTER TABLE public.legal_entities
    ADD COLUMN IF NOT EXISTS default_for_new_orders BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.legal_entities.default_for_new_orders IS
  'На это юрлицо заводится новый заказ, если менеджер не выбрал другое. Одно на всех, переключается в настройках юрлиц';

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_entities_default_for_new_orders
    ON public.legal_entities ((true))
    WHERE default_for_new_orders;

-- Как было в коде: ООО «ЗМК» (магазин zmktlt-ru).
UPDATE public.legal_entities
   SET default_for_new_orders = true
 WHERE site_code = 'zmktlt-ru'
   AND NOT EXISTS (SELECT 1 FROM public.legal_entities WHERE default_for_new_orders);

CREATE OR REPLACE FUNCTION public.set_default_legal_entity(p_id BIGINT)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.legal_entities
         WHERE id = p_id AND active AND coalesce(site_code, '') <> ''
    ) THEN
        RAISE EXCEPTION 'Юрлицо не действует или не связано с магазином — заказ на него завести нельзя';
    END IF;

    UPDATE public.legal_entities
       SET default_for_new_orders = false, updated_at = now()
     WHERE default_for_new_orders AND id <> p_id;

    UPDATE public.legal_entities
       SET default_for_new_orders = true, updated_at = now()
     WHERE id = p_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_default_legal_entity(BIGINT) TO service_role;
