-- Расширение managers для сохранения добавочного номера Телфина
-- Выполняется безопасно (IF NOT EXISTS)
ALTER TABLE public.managers
ADD COLUMN IF NOT EXISTS telphin_extension TEXT;

-- Таблица для уведомлений менеджерам о входящих звонках
CREATE TABLE IF NOT EXISTS public.manager_call_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id BIGINT NOT NULL REFERENCES public.managers(id) ON DELETE CASCADE,
  call_id TEXT NOT NULL,
  call_direction TEXT NOT NULL CHECK (call_direction IN ('incoming', 'outgoing')),
  caller_phone TEXT,
  order_id BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  order_number TEXT,
  client_name TEXT,
  status TEXT DEFAULT 'unread',  -- unread, read, dismissed
  notification_type TEXT DEFAULT 'incoming_call',  -- incoming_call, call_status, call_completed
  data JSONB,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_manager_call_notifications_manager_id
  ON public.manager_call_notifications(manager_id);
CREATE INDEX IF NOT EXISTS idx_manager_call_notifications_created_at
  ON public.manager_call_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manager_call_notifications_status
  ON public.manager_call_notifications(status) WHERE status = 'unread';
CREATE INDEX IF NOT EXISTS idx_manager_call_notifications_call_id
  ON public.manager_call_notifications(call_id);

-- RLS: менеджер видит свои уведомления
ALTER TABLE public.manager_call_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_can_view_own_call_notifications" ON public.manager_call_notifications
  FOR SELECT
  USING (manager_id = COALESCE((SELECT (auth.jwt() ->> 'user_id')::bigint), 0));

CREATE POLICY "users_can_update_own_notifications" ON public.manager_call_notifications
  FOR UPDATE
  USING (manager_id = COALESCE((SELECT (auth.jwt() ->> 'user_id')::bigint), 0));

CREATE POLICY "system_can_insert_notifications" ON public.manager_call_notifications
  FOR INSERT
  WITH CHECK (true);

-- Триггер для обновления updated_at
CREATE OR REPLACE FUNCTION update_manager_call_notifications_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_manager_call_notifications_timestamp ON public.manager_call_notifications;

CREATE TRIGGER update_manager_call_notifications_timestamp
BEFORE UPDATE ON public.manager_call_notifications
FOR EACH ROW
EXECUTE FUNCTION update_manager_call_notifications_timestamp();

-- Комментарии
COMMENT ON TABLE public.manager_call_notifications IS 'Уведомления менеджерам о входящих/исходящих звонках';
COMMENT ON COLUMN public.manager_call_notifications.status IS 'Статус уведомления: unread (новое), read (прочитано), dismissed (отклонено)';
COMMENT ON COLUMN public.managers.telphin_extension IS 'Короткий номер добавочного менеджера в системе Телфин (напр. 105)';
