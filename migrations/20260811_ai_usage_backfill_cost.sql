-- ============================================================================
-- Пересчёт стоимости уже записанных вызовов LLM.
--
-- Проблема: в ai_usage_events у ВСЕХ записей cost_usd = 0. Тариф искался по
-- точному имени модели (pricing[model] в lib/ai-usage.ts), а OpenAI возвращает
-- датированную версию — «gpt-4o-mini-2024-07-18», тогда как в ai_model_pricing
-- заведено семейство «gpt-4o-mini». Совпадения не было никогда, поэтому весь
-- журнал «зарплаты ИИ» показывал ноль: по факту только оценщик заказов тратит
-- ~$24 в месяц (~2 100 ₽).
--
-- Здесь: разово пересчитываем историю по тем же тарифам, что применяет код.
-- Правило поиска тарифа обязано совпадать с resolvePricingKey() в TS:
-- точное имя → имя без датированного суффикса → самый ДЛИННЫЙ тариф-префикс
-- (иначе «gpt-4o-mini-…» уедет в тариф «gpt-4o», который вчетверо дороже).
--
-- Тарифы — снимок на момент вызова, но исторических тарифов мы не храним, так
-- что пересчёт идёт по текущим значениям ai_model_pricing. Для наших моделей
-- они с момента заведения (июнь 2026) не менялись.
-- ============================================================================

WITH matched AS (
    SELECT e.id,
           p.input_per_1m,
           p.cached_input_per_1m,
           p.output_per_1m,
           row_number() OVER (PARTITION BY e.id ORDER BY length(p.model) DESC) AS rn
    FROM public.ai_usage_events e
    JOIN public.ai_model_pricing p
      ON regexp_replace(e.model, '-\d{4}-\d{2}-\d{2}$', '') = p.model
      OR regexp_replace(e.model, '-\d{4}-\d{2}-\d{2}$', '') LIKE p.model || '%'
    WHERE e.cost_usd = 0
)
UPDATE public.ai_usage_events e
SET cost_usd = round((
        GREATEST(e.prompt_tokens - e.cached_tokens, 0)::numeric / 1e6 * m.input_per_1m
      + e.cached_tokens::numeric / 1e6 * m.cached_input_per_1m
      + e.completion_tokens::numeric / 1e6 * m.output_per_1m
    ), 6)
FROM matched m
WHERE m.id = e.id AND m.rn = 1;
