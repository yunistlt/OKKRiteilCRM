-- Таблица для хранения запросов на отправку просмотренных товаров на email
-- Создаётся через exit-intent виджета Елены

CREATE TABLE IF NOT EXISTS widget_wishlist_requests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id  TEXT,
    session_id  UUID REFERENCES widget_sessions(id) ON DELETE SET NULL,
    email       TEXT NOT NULL,
    products    TEXT[] NOT NULL DEFAULT '{}',
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_widget_wishlist_requests_visitor ON widget_wishlist_requests(visitor_id);
CREATE INDEX IF NOT EXISTS idx_widget_wishlist_requests_status  ON widget_wishlist_requests(status);
CREATE INDEX IF NOT EXISTS idx_widget_wishlist_requests_created ON widget_wishlist_requests(created_at DESC);

-- RLS: только сервисный ключ имеет доступ
ALTER TABLE widget_wishlist_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON widget_wishlist_requests
    FOR ALL USING (auth.role() = 'service_role');
