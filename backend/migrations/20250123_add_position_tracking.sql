-- Add position tracking fields to strategies table
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS is_position_open BOOLEAN DEFAULT false;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS current_position JSONB;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS position_last_updated TIMESTAMP WITH TIME ZONE;

-- Add index for position queries
CREATE INDEX IF NOT EXISTS idx_strategies_position_open ON strategies(is_position_open) WHERE is_position_open = true;

-- Add comments for clarity
COMMENT ON COLUMN strategies.is_position_open IS 'Whether the strategy currently has an open position on Drift';
COMMENT ON COLUMN strategies.current_position IS 'JSON object containing current position details (direction, size, entry price, etc.)';
COMMENT ON COLUMN strategies.position_last_updated IS 'Timestamp when position information was last updated';
