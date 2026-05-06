-- Таблица настроек виджета Ловца Лидов
-- Одна строка на всё — конфиг хранится в JSONB

CREATE TABLE IF NOT EXISTS widget_settings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config      JSONB NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  TEXT
);

-- Только одна строка
CREATE UNIQUE INDEX IF NOT EXISTS widget_settings_single_row ON widget_settings ((TRUE));

-- RLS
ALTER TABLE widget_settings ENABLE ROW LEVEL SECURITY;

-- Только авторизованные могут менять
CREATE POLICY "widget_settings_read"  ON widget_settings FOR SELECT USING (true);
CREATE POLICY "widget_settings_write" ON widget_settings FOR ALL   USING (auth.uid() IS NOT NULL);

-- Вставляем дефолтные настройки
INSERT INTO widget_settings (config) VALUES ('{
  "enabled": true,
  "agent_name": "Елена (ЗМК)",
  "agent_title": "В сети • Продуктолог",
  "agent_avatar_url": "https://okk.zmksoft.com/images/agents/elena.png",
  "primary_color": "#10b981",
  "position_bottom": 260,
  "position_right": 20,
  "auto_expand_delay_ms": 30000,
  "greeting_delay1_ms": 10000,
  "greeting_delay2_ms": 20000,
  "quick_buttons_delay_ms": 25000,
  "exit_intent_enabled": true,
  "email_capture_enabled": true,
  "quick_buttons_enabled": true,
  "allowed_domains": []
}') ON CONFLICT DO NOTHING;
