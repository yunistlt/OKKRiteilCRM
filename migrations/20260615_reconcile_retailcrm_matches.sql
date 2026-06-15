-- Авторитетная привязка звонок→заказ из RetailCRM в call_order_matches.
-- RetailCRM (retailcrm_calls.order_number) надёжнее нашего эвристического lib/call-matching.ts
-- (расхождение ~29% на низкоуверенных by_phone_manager). Функция:
--   1) апсертит RC-привязки (match_type='retailcrm', confidence 1.0), стыкуя звонок с аудио
--      по «второй наклейке» (external_id ∈ raw_telphin_calls.record_uuids) и заказ по orders.number;
--   2) удаляет конфликтующие ЭВРИСТИЧЕСКИЕ привязки того же звонка к ДРУГОМУ заказу
--      (match_type не из manual/retailcrm) — чтобы звонок не висел на двух заказах.
-- Ручные привязки (match_type='manual') неприкосновенны и имеют приоритет: при их наличии
-- RC-привязка для этого звонка не ставится. Идемпотентна, безопасна для повторного вызова.

-- Расширяем CHECK на match_type новым источником 'retailcrm' (+ 'by_phone_window' из TS-типа).
ALTER TABLE call_order_matches DROP CONSTRAINT IF EXISTS call_order_matches_match_type_check;
ALTER TABLE call_order_matches ADD CONSTRAINT call_order_matches_match_type_check
    CHECK (match_type = ANY (ARRAY[
        'by_phone_time', 'by_phone_manager', 'by_partial_phone', 'manual',
        'by_phone_day', 'by_phone_any', 'by_phone_window', 'retailcrm'
    ]));

CREATE OR REPLACE FUNCTION reconcile_retailcrm_call_matches()
RETURNS TABLE(upserted integer, deleted_conflicts integer)
LANGUAGE plpgsql AS $$
DECLARE
    v_upserted integer := 0;
    v_deleted integer := 0;
BEGIN
    WITH src AS (
        -- одна строка на пару (звонок, заказ): у мультиплечевого звонка несколько RC-строк
        -- могут указывать на один заказ — иначе ON CONFLICT затронет строку дважды.
        SELECT DISTINCT ON (t.telphin_call_id, o.id)
               t.telphin_call_id, o.id AS order_id, rc.order_number, rc.rc_call_id
        FROM retailcrm_calls rc
        JOIN orders o ON o.number = rc.order_number
        JOIN raw_telphin_calls t ON lower(rc.external_id) = ANY(t.record_uuids)
        WHERE rc.order_number IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM call_order_matches m
              WHERE m.telphin_call_id = t.telphin_call_id AND m.match_type = 'manual'
          )
        ORDER BY t.telphin_call_id, o.id, rc.rc_call_id
    ),
    ins AS (
        INSERT INTO call_order_matches AS m
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

    WITH src AS (
        SELECT DISTINCT t.telphin_call_id, o.id AS order_id
        FROM retailcrm_calls rc
        JOIN orders o ON o.number = rc.order_number
        JOIN raw_telphin_calls t ON lower(rc.external_id) = ANY(t.record_uuids)
        WHERE rc.order_number IS NOT NULL
    ),
    del AS (
        DELETE FROM call_order_matches m
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
