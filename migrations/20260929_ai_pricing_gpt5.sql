-- Тарифы моделей gpt-5.x в журнале расходов.
--
-- Без этих строк resolvePricingKey не находил тариф и писал в ai_usage_events
-- cost_usd = 0: самая дорогая статья расхода (чат Тамары на gpt-5.5) в отчёте
-- показывалась нулём, при том что в биллинге OpenAI за неделю по ней прошло
-- больше тридцати долларов.
--
-- Ставки не оценочные: посчитаны из organization/costs, поделённых на
-- фактические токены за 15 дней (gpt-5.5 — 5.00 / 0.50 / 30.00 ровно).
-- Кэшированный вход у gpt-5.5 вышел десятой частью свежего; для 5.4 и 5.4-mini
-- кэша в выборке не было, взята та же десятая доля.
INSERT INTO ai_model_pricing (model, input_per_1m, cached_input_per_1m, output_per_1m, note) VALUES
    ('gpt-5.5',      5.0000, 0.5000, 30.0000, 'OpenAI gpt-5.5 (чат и отчёты Тамары)'),
    ('gpt-5.4',      2.5000, 0.2500, 15.0000, 'OpenAI gpt-5.4'),
    ('gpt-5.4-mini', 0.7500, 0.0750,  4.5000, 'OpenAI gpt-5.4-mini')
ON CONFLICT (model) DO UPDATE SET
    input_per_1m = EXCLUDED.input_per_1m,
    cached_input_per_1m = EXCLUDED.cached_input_per_1m,
    output_per_1m = EXCLUDED.output_per_1m,
    note = EXCLUDED.note,
    updated_at = NOW();
