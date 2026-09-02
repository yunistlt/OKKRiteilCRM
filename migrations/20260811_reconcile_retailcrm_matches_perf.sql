-- ============================================================================
-- Авторитетная привязка звонок→заказ из RetailCRM: починка (она не работала).
--
-- Что было. Функция reconcile_retailcrm_call_matches() из
-- 20260615_reconcile_retailcrm_matches.sql вызывается кроном каждые 2 минуты
-- (/api/sync/retailcrm/calls), но в call_order_matches НЕ БЫЛО НИ ОДНОЙ строки
-- с match_type='retailcrm'. Причина не в логике: стыковка
-- lower(rc.external_id) ∈ raw_telphin_calls.record_uuids сама по себе верна и
-- покрывает 532 из 739 августовских RC-звонков. Функция просто НЕ ДОХОДИЛА ДО
-- КОНЦА — падала с 57014 (statement timeout, замер: 121 с):
--   • join шёл по = ANY(record_uuids) без индекса → полный перебор
--     15 тыс. RC-звонков × 35 тыс. массивов record_uuids на КАЖДОМ прогоне;
--   • окна по дате не было — каждые 2 минуты пересчитывалась вся история.
-- А вызов в роуте обёрнут в try/catch, поэтому ошибка не всплывала никуда:
-- крон рапортовал успех, привязок не появлялось. Два месяца тишины.
--
-- Цена бездействия (сверка за май–август, 3 724 звонка, у которых RetailCRM
-- знает заказ): наша эвристика попала в 1 917 случаях (51%), ошиблась в 720
-- (19%) и вообще не связала 1 087 (29%). Характерная патология эвристики —
-- звонок вешается на все прошлые заказы клиента (реальный случай: 12 заказов
-- на один звонок), и транскрипт прилипает к чужим сделкам, а это питает ОКК.
--
-- Что делаем здесь:
--   1) GIN-индекс на record_uuids + индекс на retailcrm_calls(call_date) —
--      join становится индексным;
--   2) окно p_since: штатный прогон разбирает только свежий хвост (по умолчанию
--      7 дней), а не всю историю. Бэкфилл делается разово явным p_since;
--   3) DISTINCT ON и приоритет ручных привязок сохранены без изменений.
-- Семантика привязок не меняется: RC — источник истины, эвристика остаётся
-- фолбэком для звонков, которых RetailCRM не связала.
-- ============================================================================

-- 1) Индексы под join. GIN по массиву плеч звонка — чтобы @> искал по индексу,
--    а не перебором; частичный индекс по дате — чтобы окно резалось дёшево.
CREATE INDEX IF NOT EXISTS idx_raw_telphin_calls_record_uuids
    ON public.raw_telphin_calls USING gin (record_uuids);

CREATE INDEX IF NOT EXISTS idx_retailcrm_calls_date_with_order
    ON public.retailcrm_calls (call_date)
    WHERE order_number IS NOT NULL;

-- 2) Функция с окном. Прежняя сигнатура (без аргументов) остаётся рабочей —
--    p_since необязательный, поэтому старый деплой кода не ломается.
DROP FUNCTION IF EXISTS public.reconcile_retailcrm_call_matches();
DROP FUNCTION IF EXISTS public.reconcile_retailcrm_call_matches(timestamptz);
CREATE OR REPLACE FUNCTION public.reconcile_retailcrm_call_matches(
    p_since timestamptz DEFAULT NULL
)
RETURNS TABLE(upserted integer, deleted_conflicts integer)
LANGUAGE plpgsql AS $$
DECLARE
    v_upserted integer := 0;
    v_deleted integer := 0;
    v_since timestamptz := COALESCE(p_since, now() - interval '7 days');
BEGIN
    WITH src AS (
        -- одна строка на пару (звонок, заказ): у мультиплечевого звонка несколько RC-строк
        -- могут указывать на один заказ — иначе ON CONFLICT затронет строку дважды.
        SELECT DISTINCT ON (t.telphin_call_id, o.order_id)
               t.telphin_call_id, o.order_id, rc.order_number, rc.rc_call_id
        FROM public.retailcrm_calls rc
        JOIN public.orders o ON o.number = rc.order_number
        -- @> вместо = ANY(...): оператор включения массива берёт GIN-индекс
        JOIN public.raw_telphin_calls t ON t.record_uuids @> ARRAY[lower(rc.external_id)]
        WHERE rc.order_number IS NOT NULL
          AND rc.call_date >= v_since
          AND NOT EXISTS (
              SELECT 1 FROM public.call_order_matches m
              WHERE m.telphin_call_id = t.telphin_call_id AND m.match_type = 'manual'
          )
        ORDER BY t.telphin_call_id, o.order_id, rc.rc_call_id
    ),
    ins AS (
        INSERT INTO public.call_order_matches AS m
            (telphin_call_id, retailcrm_order_id, match_type, confidence_score, matched_at, explanation, matching_factors)
        SELECT s.telphin_call_id, s.order_id, 'retailcrm', 1.0, now(),
               'Привязка к заказу из RetailCRM (telephony/calls)',
               jsonb_build_object('source', 'retailcrm', 'order_number', s.order_number, 'rc_call_id', s.rc_call_id)
        FROM src s
        ON CONFLICT (telphin_call_id, retailcrm_order_id)
        DO UPDATE SET match_type = 'retailcrm', confidence_score = 1.0, matched_at = now(),
                      explanation = EXCLUDED.explanation, matching_factors = EXCLUDED.matching_factors
        RETURNING 1
    )
    SELECT count(*) INTO v_upserted FROM ins;

    -- Конфликтующие ЭВРИСТИЧЕСКИЕ привязки того же звонка к ДРУГОМУ заказу
    -- удаляем: RetailCRM знает, к какому заказу относится звонок, а догадка
    -- «по последним 7 цифрам» вешала его ещё и на прошлые заказы клиента.
    -- Ручные привязки (manual) неприкосновенны.
    WITH src AS (
        SELECT DISTINCT t.telphin_call_id, o.order_id
        FROM public.retailcrm_calls rc
        JOIN public.orders o ON o.number = rc.order_number
        JOIN public.raw_telphin_calls t ON t.record_uuids @> ARRAY[lower(rc.external_id)]
        WHERE rc.order_number IS NOT NULL
          AND rc.call_date >= v_since
    ),
    del AS (
        DELETE FROM public.call_order_matches m
        USING src s
        WHERE m.telphin_call_id = s.telphin_call_id
          AND m.retailcrm_order_id <> s.order_id
          AND m.match_type NOT IN ('manual', 'retailcrm')
        RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM del;

    RETURN QUERY SELECT v_upserted, v_deleted;
END;
$$;
