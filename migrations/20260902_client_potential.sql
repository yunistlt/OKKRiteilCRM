-- Потенциал клиента: чем он может стать, а не сколько уже принёс.
--
-- Отбор по деньгам ставит мелкого постоянного покупателя выше Росатома, который
-- обратился и не купил. Для базы, где половина клиентов не купила ничего, это
-- значит, что крупные несостоявшиеся заказчики не попадают в план никогда.
--
-- Данные о компании берём из Dadata по ИНН: отрасль, регион, число филиалов,
-- жив ли контрагент. Выручку и штат бесплатный тариф не отдаёт — на них логику
-- не строим.
ALTER TABLE public.sales_client_relation
    ADD COLUMN IF NOT EXISTS okved_code text,
    ADD COLUMN IF NOT EXISTS activity text,
    ADD COLUMN IF NOT EXISTS region text,
    ADD COLUMN IF NOT EXISTS branches int,
    ADD COLUMN IF NOT EXISTS company_alive boolean,
    ADD COLUMN IF NOT EXISTS company_status text,
    /** Когда последний раз спрашивали Dadata. Пусто — ещё не спрашивали. */
    ADD COLUMN IF NOT EXISTS enriched_at timestamptz,
    /**
     * Множитель потенциала: во сколько раз этот клиент интереснее среднего при
     * равных деньгах. Пересчитывается вместе со снимком.
     */
    ADD COLUMN IF NOT EXISTS potential numeric NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_client_relation_enrich ON public.sales_client_relation (enriched_at)
    WHERE inn IS NOT NULL;

-- Веса потенциала. В базе, а не в коде: что считать интересной отраслью —
-- решение владельца, и оно будет меняться.
INSERT INTO public.sales_rop_settings (key, value, comment) VALUES
    ('potential_industry_weights',
     '{"C":2.0,"B":1.8,"D":1.6,"F":1.4,"H":1.3,"E":1.2,"O":1.2,"G":0.7}',
     'Множитель по разделу ОКВЭД: C — обрабатывающие производства, B — добыча, D — энергетика, F — строительство, H — транспорт, G — торговля (посредники дешевле). Остальные — 1.0'),
    ('potential_branch_bonus', '0.1', 'Прибавка за каждый филиал (площадка = ещё один комплект мебели), максимум +1.0'),
    ('potential_max', '3.0', 'Потолок множителя: даже у гиганта план не должен состоять из него одного')
ON CONFLICT (key) DO UPDATE SET comment = EXCLUDED.comment;

-- Раздел ОКВЭД по коду: 25.11 → C. Разделы заданы диапазонами классов, как в
-- самом классификаторе.
CREATE OR REPLACE FUNCTION public.okved_section(p_code text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $function$
    SELECT CASE
        WHEN p_code IS NULL OR p_code = '' THEN ''
        ELSE (
            WITH n AS (SELECT split_part(p_code, '.', 1)::int AS c)
            SELECT CASE
                WHEN n.c BETWEEN 1 AND 3 THEN 'A'
                WHEN n.c BETWEEN 5 AND 9 THEN 'B'
                WHEN n.c BETWEEN 10 AND 33 THEN 'C'
                WHEN n.c = 35 THEN 'D'
                WHEN n.c BETWEEN 36 AND 39 THEN 'E'
                WHEN n.c BETWEEN 41 AND 43 THEN 'F'
                WHEN n.c BETWEEN 45 AND 47 THEN 'G'
                WHEN n.c BETWEEN 49 AND 53 THEN 'H'
                WHEN n.c BETWEEN 55 AND 56 THEN 'I'
                WHEN n.c BETWEEN 58 AND 63 THEN 'J'
                WHEN n.c BETWEEN 64 AND 66 THEN 'K'
                WHEN n.c = 68 THEN 'L'
                WHEN n.c BETWEEN 69 AND 75 THEN 'M'
                WHEN n.c BETWEEN 77 AND 82 THEN 'N'
                WHEN n.c = 84 THEN 'O'
                WHEN n.c = 85 THEN 'P'
                WHEN n.c BETWEEN 86 AND 88 THEN 'Q'
                WHEN n.c BETWEEN 90 AND 93 THEN 'R'
                ELSE ''
            END FROM n
        )
    END;
$function$;

-- Пересчёт множителя потенциала по уже собранным данным о компаниях.
CREATE OR REPLACE FUNCTION public.sales_refresh_client_potential()
RETURNS int
LANGUAGE plpgsql AS $function$
DECLARE
    v_weights jsonb;
    v_branch numeric;
    v_max numeric;
    v_count int;
BEGIN
    SELECT coalesce(max(value)::jsonb, '{}'::jsonb) INTO v_weights
      FROM public.sales_rop_settings WHERE key = 'potential_industry_weights';
    SELECT coalesce(max(value)::numeric, 0.1) INTO v_branch
      FROM public.sales_rop_settings WHERE key = 'potential_branch_bonus';
    SELECT coalesce(max(value)::numeric, 3.0) INTO v_max
      FROM public.sales_rop_settings WHERE key = 'potential_max';

    UPDATE public.sales_client_relation r
       SET potential = LEAST(
               v_max,
               -- Отрасль по разделу ОКВЭД плюс надбавка за филиалы.
               coalesce((v_weights ->> public.okved_section(r.okved_code))::numeric, 1.0)
                   + LEAST(1.0, coalesce(r.branches, 0) * v_branch)
           ),
           -- Ликвидируется или банкротится — звонить незачем. Это не наказание
           -- клиента, а экономия времени менеджера.
           muted = CASE WHEN r.company_alive IS FALSE THEN true ELSE r.muted END,
           muted_reason = CASE
               WHEN r.company_alive IS FALSE THEN coalesce(r.company_status, 'компания не действует')
               ELSE r.muted_reason
           END
     WHERE r.enriched_at IS NOT NULL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$function$;

-- Отбор кандидатов с учётом потенциала: чем клиент может стать, а не только
-- сколько уже принёс. Множитель применяется к весу — деньги остаются основой,
-- иначе в план полезут пустые компании из «правильных» отраслей.
DROP FUNCTION IF EXISTS public.sales_client_touch_candidates(date, int);

CREATE FUNCTION public.sales_client_touch_candidates(p_today date, p_per_group int DEFAULT 5)
RETURNS TABLE (
    client_key text,
    client_name text,
    manager_id bigint,
    stage text,
    orders_count int,
    total_summ numeric,
    days_since int,
    last_order_id bigint,
    last_order_number text,
    last_order_amount numeric,
    activity text,
    branches int,
    potential numeric
)
LANGUAGE sql STABLE AS $function$
    WITH ranked AS (
        SELECT r.*,
               GREATEST(r.total_summ, r.last_order_amount) * r.potential AS weight,
               row_number() OVER (
                   PARTITION BY r.manager_id, (r.stage = 'kupil')
                   ORDER BY GREATEST(r.total_summ, r.last_order_amount) * r.potential DESC,
                            r.last_touch_at ASC NULLS LAST
               ) AS rn
          FROM public.sales_client_relation r
         WHERE NOT r.muted
           AND NOT r.has_open_deal
           AND r.manager_id IS NOT NULL
           AND r.next_contact_at <= p_today
    )
    SELECT client_key, client_name, manager_id, stage, orders_count, total_summ,
           EXTRACT(DAY FROM now() - last_touch_at)::int,
           last_order_id, last_order_number, last_order_amount,
           activity, branches, potential
      FROM ranked
     WHERE rn <= p_per_group
     ORDER BY weight DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_client_touch_candidates(date, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_refresh_client_potential() TO service_role;
GRANT EXECUTE ON FUNCTION public.okved_section(text) TO service_role;
