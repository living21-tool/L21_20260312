-- Agent configuration table for L21 AI Assistant
-- Stores which tools are enabled for the AI agent

CREATE TABLE IF NOT EXISTS agent_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  enabled_tools TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE agent_config ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read and write
CREATE POLICY "Authenticated users can read agent_config"
  ON agent_config FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update agent_config"
  ON agent_config FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can insert agent_config"
  ON agent_config FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow service role full access
CREATE POLICY "Service role full access on agent_config"
  ON agent_config FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Insert default config: all query tools enabled, action tools disabled
INSERT INTO agent_config (id, enabled_tools) VALUES (
  'default',
  ARRAY[
    'check_availability',
    'search_bookings',
    'search_customers',
    'get_customer',
    'get_sync_state',
    'list_import_queue'
  ]
) ON CONFLICT (id) DO NOTHING;
