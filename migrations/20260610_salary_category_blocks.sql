-- ============================================================================
-- Разделение премии: «тип клиента» (premia_zayavki) и «категории товара».
--
-- Раньше блок premia_zayavki считал три взаимоисключающие корзины
-- new/permanent/pech_vto в одном параметре rates. Печь/ВТО — это КАТЕГОРИЯ
-- ТОВАРА (orders.customFields.typ_castomer), а не тип клиента, и должна жить в
-- отдельном настраиваемом блоке (premia_categorii / coef_categorii).
--
-- Код блока premia_zayavki теперь читает только rates.new/permanent
-- (lib/salary/blocks/core-blocks.ts), а печь/ВТО оплачивает premia_categorii.
-- Чтобы суммы выплат НЕ изменились ни в одном периоде, эта миграция:
--   1) добавляет premia_categorii в каждую схему, где premia_zayavki платил
--      печь/ВТО — по строке на каждую категорию из category_pech_vto_map,
--      режим «Сумма», ставка = прежний rates.pech_vto этой же схемы;
--   2) убирает ключ pech_vto из premia_zayavki.rates.
--
-- Слаги категорий и ставка НЕ захардкожены — берутся из текущего salary_config
-- и из самих параметров схем. Идемпотентна. Печь/ВТО и так исключается из
-- new/permanent на этапе classifyOrderType (config.category_pech_vto_map), так
-- что корзины не пересекаются и double-count невозможен.
-- ============================================================================

-- 1. premia_categorii = печь/ВТО по строке на категорию (режим «Сумма»)
INSERT INTO public.salary_scheme_block (scheme_id, block_code, sort_order, params, enabled)
SELECT
    b.scheme_id,
    'premia_categorii',
    b.sort_order,  -- рядом с premia_zayavki (UI сортирует по sort_order)
    jsonb_build_object('rows', (
        SELECT jsonb_agg(
            jsonb_build_object(
                'category', c,
                'mode', 'sum',
                'value', (b.params -> 'rates' ->> 'pech_vto')::numeric
            )
        )
        FROM jsonb_array_elements_text(
            (SELECT value FROM public.salary_config
             WHERE key = 'category_pech_vto_map'
             ORDER BY effective_from DESC LIMIT 1)
        ) AS c
    )),
    true
FROM public.salary_scheme_block b
WHERE b.block_code = 'premia_zayavki'
  AND (b.params -> 'rates' ->> 'pech_vto') IS NOT NULL
  AND (b.params -> 'rates' ->> 'pech_vto')::numeric > 0
  AND NOT EXISTS (
      SELECT 1 FROM public.salary_scheme_block b2
      WHERE b2.scheme_id = b.scheme_id AND b2.block_code = 'premia_categorii'
  )
ON CONFLICT (scheme_id, block_code) DO NOTHING;

-- 2. Убрать pech_vto из premia_zayavki.rates (new/permanent остаются как были)
UPDATE public.salary_scheme_block
SET params = params #- '{rates,pech_vto}'
WHERE block_code = 'premia_zayavki'
  AND params -> 'rates' ? 'pech_vto';
