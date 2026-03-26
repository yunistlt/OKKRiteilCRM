-- Расширение модуля ИИ-Реактиватор: гибкие настройки кампаний
-- Дата: 2026-03-26

-- Добавляем колонку settings для настроек агентов (промпт, действие при POSITIVE и т.д.)
ALTER TABLE ai_reactivation_campaigns
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}';

-- Расширяем индекс для поиска активных кампаний
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON ai_reactivation_campaigns(status);

-- Структура settings (документация):
-- {
--   "victoria_prompt": "...",           -- промпт агента-писателя (переопределяет дефолт)
--   "email_subject": "Re: Заказ #{{ order_number }}", -- шаблон темы
--   "on_positive": "create_order",      -- или "send_reply"
--   "new_order_status": "new",          -- статус нового заказа
--   "reply_prompt": "..."               -- промпт ответного письма (если on_positive=send_reply)
-- }

-- Структура filters (документация):
-- {
--   "b2b_only": true,
--   "months": 6,
--   "min_ltv": 0,
--   "min_orders": 1,
--   "max_orders": null,
--   "min_avg_check": 0,
--   "max_avg_check": null,
--   "statuses": ["cancel-other"],       -- фильтр по статусу последнего заказа
--   "custom_fields": [                  -- фильтр по пользовательским полям клиента
--     { "field": "sphere", "value": "строительство" }
--   ]
-- }
