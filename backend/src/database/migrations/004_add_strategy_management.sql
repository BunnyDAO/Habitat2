-- Add columns to strategies table for job management and lackey support
ALTER TABLE strategies
    ADD COLUMN last_executed TIMESTAMP WITH TIME ZONE,
    ADD COLUMN next_execution TIMESTAMP WITH TIME ZONE,
    ADD COLUMN position INTEGER,
    ADD COLUMN is_lackey BOOLEAN DEFAULT false,
    ADD COLUMN original_wallet_pubkey VARCHAR(44),
    ADD COLUMN current_wallet_pubkey VARCHAR(44);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_strategies_next_execution ON strategies(next_execution);
CREATE INDEX IF NOT EXISTS idx_strategies_is_lackey ON strategies(is_lackey);
CREATE INDEX IF NOT EXISTS idx_strategies_position ON strategies(position);
CREATE INDEX IF NOT EXISTS idx_strategies_original_wallet ON strategies(original_wallet_pubkey);
CREATE INDEX IF NOT EXISTS idx_strategies_current_wallet ON strategies(current_wallet_pubkey);

-- Add comment to explain the new columns
COMMENT ON COLUMN strategies.last_executed IS 'Timestamp of the last strategy execution';
COMMENT ON COLUMN strategies.next_execution IS 'Scheduled time for next strategy execution';
COMMENT ON COLUMN strategies.position IS 'Position number for lackey strategies (1, 2, or 3)';
COMMENT ON COLUMN strategies.is_lackey IS 'Whether this strategy is a lackey (importable/exportable)';
COMMENT ON COLUMN strategies.original_wallet_pubkey IS 'Original wallet public key for lackey strategies';
COMMENT ON COLUMN strategies.current_wallet_pubkey IS 'Current wallet public key for lackey strategies'; 