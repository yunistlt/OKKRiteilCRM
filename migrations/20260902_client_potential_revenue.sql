-- Масштаб клиента по обороту, если тариф Dadata его отдаёт.
--
-- Отрасль — грубая мерка: «производство мебели» одинаково у цеха на пять
-- человек и у фабрики на миллиард. Выручка из отчётности ФНС различает их
-- сразу. На бесплатном тарифе подсказок поля finance и employee_count приходят
-- пустыми (проверено на Газпроме — пусто), поэтому логика построена так:
-- цифры есть — считаем по ним, цифр нет — работает прежняя оценка по ОКВЭД.
-- Ничего не ломается ни при подключении платного тарифа, ни при отказе от него.
ALTER TABLE public.sales_client_relation
    ADD COLUMN IF NOT EXISTS employees int,
    ADD COLUMN IF NOT EXISTS revenue numeric,
    ADD COLUMN IF NOT EXISTS revenue_year int;

-- Ступени по обороту. В базе: где проходит граница «крупного» — решение
-- владельца, и на разных рынках оно разное.
INSERT INTO public.sales_rop_settings (key, value, comment) VALUES
    ('potential_revenue_steps',
     '[{"from":1000000000,"weight":3.0},{"from":300000000,"weight":2.5},{"from":100000000,"weight":2.0},{"from":30000000,"weight":1.5},{"from":0,"weight":1.0}]',
     'Множитель по годовой выручке клиента (₽): от миллиарда — 3.0, от 300 млн — 2.5, от 100 млн — 2.0, от 30 млн — 1.5. Работает, только если тариф Dadata отдаёт выручку')
ON CONFLICT (key) DO UPDATE SET comment = EXCLUDED.comment;

CREATE OR REPLACE FUNCTION public.sales_refresh_client_potential()
RETURNS int
LANGUAGE plpgsql AS $function$
DECLARE
    v_weights jsonb;
    v_steps jsonb;
    v_branch numeric;
    v_max numeric;
    v_count int;
BEGIN
    SELECT coalesce(max(value)::jsonb, '{}'::jsonb) INTO v_weights
      FROM public.sales_rop_settings WHERE key = 'potential_industry_weights';
    SELECT coalesce(max(value)::jsonb, '[]'::jsonb) INTO v_steps
      FROM public.sales_rop_settings WHERE key = 'potential_revenue_steps';
    SELECT coalesce(max(value)::numeric, 0.1) INTO v_branch
      FROM public.sales_rop_settings WHERE key = 'potential_branch_bonus';
    SELECT coalesce(max(value)::numeric, 3.0) INTO v_max
      FROM public.sales_rop_settings WHERE key = 'potential_max';

    UPDATE public.sales_client_relation r
       SET potential = LEAST(
               v_max,
               GREATEST(
                   -- Отрасль: работает всегда.
                   coalesce((v_weights ->> public.okved_section(r.okved_code))::numeric, 1.0),
                   -- Оборот: только когда цифра приехала. Ноль и NULL — это
                   -- «не знаем», а не «маленькая компания».
                   CASE WHEN coalesce(r.revenue, 0) > 0 THEN (
                       SELECT coalesce((s ->> 'weight')::numeric, 1.0)
                         FROM jsonb_array_elements(v_steps) s
                        WHERE r.revenue >= (s ->> 'from')::numeric
                        ORDER BY (s ->> 'from')::numeric DESC
                        LIMIT 1
                   ) ELSE 1.0 END
               )
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

GRANT EXECUTE ON FUNCTION public.sales_refresh_client_potential() TO service_role;
