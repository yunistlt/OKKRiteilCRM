-- Магазин для заявок с почты — настройкой, а не только переменной окружения.
--
-- Инцидент 30.09.2026: RetailCRM перестала принимать магазин zmktlt-ru на
-- создание заказов («Invalid value for parameter 'site'»). С 07:53 до обеда ни
-- одна заявка с почты не завелась — 10 писем ушли в ошибку, а узнали мы об этом
-- от менеджеров. Код при этом был исправен: магазин пропал на стороне CRM.
--
-- Что даёт эта настройка: магазин можно сменить из интерфейса, не трогая
-- переменные Vercel и не выкатывая код, а воркер сам проверяет магазин по
-- справочнику и переходит на запасной, если основной недоступен.

ALTER TABLE public.email_intake_config
    ADD COLUMN IF NOT EXISTS lead_site TEXT,
    ADD COLUMN IF NOT EXISTS lead_site_fallback TEXT;

COMMENT ON COLUMN public.email_intake_config.lead_site IS
  'Магазин RetailCRM для заявок с почты. Пусто — берём из переменной окружения';
COMMENT ON COLUMN public.email_intake_config.lead_site_fallback IS
  'Запасной магазин: берётся, если основной пропал из справочника RetailCRM';
