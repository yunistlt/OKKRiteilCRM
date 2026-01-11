-- Migration: Create AI Routing Logs Table
-- Purpose: Track all AI-powered order status changes for audit and rollback

CREATE TABLE IF NOT EXISTS ai_routing_logs (
  id BIGSERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  manager_comment TEXT,
  ai_reasoning TEXT,
  confidence DECIMAL(3,2),
  was_applied BOOLEAN DEFAULT false,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Foreign key to orders table
  CONSTRAINT fk_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_ai_routing_logs_order_id ON ai_routing_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_ai_routing_logs_created_at ON ai_routing_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_routing_logs_was_applied ON ai_routing_logs(was_applied);

-- Comment
COMMENT ON TABLE ai_routing_logs IS 'Audit log for AI-powered automatic order status routing';
