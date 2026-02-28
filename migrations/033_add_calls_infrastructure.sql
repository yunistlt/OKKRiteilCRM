-- Таблица исходящих звонков
CREATE TABLE IF NOT EXISTS outgoing_calls (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  manager_id BIGINT NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  call_sid TEXT UNIQUE NOT NULL,
  phone_number TEXT NOT NULL,
  status TEXT DEFAULT 'initiated', -- initiated, ringing, connected, completed, failed
  duration_seconds INT,
  recording_url TEXT,
  transcription_text TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Таблица входящих звонков
CREATE TABLE IF NOT EXISTS incoming_calls (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  call_sid TEXT UNIQUE NOT NULL,
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  assigned_manager_id BIGINT REFERENCES managers(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'ringing', -- ringing, connected, completed, missed, failed
  duration_seconds INT,
  recording_url TEXT,
  transcription_text TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Таблица очереди транскрибации
CREATE TABLE IF NOT EXISTS transcription_queue (
  id BIGSERIAL PRIMARY KEY,
  call_id TEXT NOT NULL,
  recording_url TEXT NOT NULL,
  type TEXT DEFAULT 'incoming_call', -- incoming_call, outgoing_call
  status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  transcription_text TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- История всех событий звонков
CREATE TABLE IF NOT EXISTS call_events (
  id BIGSERIAL PRIMARY KEY,
  call_sid TEXT NOT NULL,
  event_type TEXT NOT NULL, -- initiated, ringing, connected, completed, failed, recording_ready
  event_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_outgoing_calls_manager ON outgoing_calls(manager_id);
CREATE INDEX IF NOT EXISTS idx_outgoing_calls_order ON outgoing_calls(order_id);
CREATE INDEX IF NOT EXISTS idx_outgoing_calls_created ON outgoing_calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incoming_calls_order ON incoming_calls(order_id);
CREATE INDEX IF NOT EXISTS idx_incoming_calls_manager ON incoming_calls(assigned_manager_id);
CREATE INDEX IF NOT EXISTS idx_incoming_calls_created ON incoming_calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_events_call_sid ON call_events(call_sid);
CREATE INDEX IF NOT EXISTS idx_transcription_queue_status ON transcription_queue(status);

-- Обновляем updated_at автоматически
CREATE OR REPLACE FUNCTION update_call_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Создаём триггеры только если их ещё нет (безопасно)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'update_outgoing_calls_timestamp'
  ) THEN
    CREATE TRIGGER update_outgoing_calls_timestamp
    BEFORE UPDATE ON outgoing_calls
    FOR EACH ROW
    EXECUTE FUNCTION update_call_timestamp();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'update_incoming_calls_timestamp'
  ) THEN
    CREATE TRIGGER update_incoming_calls_timestamp
    BEFORE UPDATE ON incoming_calls
    FOR EACH ROW
    EXECUTE FUNCTION update_call_timestamp();
  END IF;
END $$;

-- Unified view для временной шкалы всех звонков (безопасное создание/обновление)
CREATE OR REPLACE VIEW call_timeline AS
SELECT 
  'outgoing' as direction,
  oc.id,
  oc.call_sid,
  oc.order_id,
  oc.manager_id,
  oc.phone_number as contact,
  oc.status,
  oc.duration_seconds,
  oc.created_at,
  oc.recording_url
FROM outgoing_calls oc
UNION ALL
SELECT 
  'incoming',
  ic.id,
  ic.call_sid,
  ic.order_id,
  ic.assigned_manager_id,
  ic.from_number,
  ic.status,
  ic.duration_seconds,
  ic.created_at,
  ic.recording_url
FROM incoming_calls ic
ORDER BY created_at DESC;
