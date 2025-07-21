-- Migration: Create trade_history table for pair trade audit trail
CREATE TABLE IF NOT EXISTS trade_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id integer NOT NULL,
    trade_type varchar(20) NOT NULL CHECK (trade_type IN ('initial_allocation', 'signal_trade')),
    from_token varchar(1) CHECK (from_token IN ('A', 'B')),
    to_token varchar(1) CHECK (to_token IN ('A', 'B')),
    from_mint varchar(44) NOT NULL,
    to_mint varchar(44) NOT NULL,
    input_amount bigint NOT NULL,
    output_amount bigint NOT NULL,
    percentage_traded decimal(5,2),
    slippage_bps integer,
    jupiter_signature varchar(88),
    signal_data jsonb,
    execution_status varchar(20) NOT NULL DEFAULT 'pending' CHECK (execution_status IN ('pending', 'completed', 'failed', 'partial')),
    error_message text,
    gas_used bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    
    CONSTRAINT fk_trade_history_strategy FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
);

-- Create indexes for performance and queries
CREATE INDEX IF NOT EXISTS idx_trade_history_strategy_id ON trade_history(strategy_id);
CREATE INDEX IF NOT EXISTS idx_trade_history_created_at ON trade_history(created_at);
CREATE INDEX IF NOT EXISTS idx_trade_history_execution_status ON trade_history(execution_status);
CREATE INDEX IF NOT EXISTS idx_trade_history_trade_type ON trade_history(trade_type);

-- Create index for signal data queries (if needed)
CREATE INDEX IF NOT EXISTS idx_trade_history_signal_data ON trade_history USING gin (signal_data);

-- Add comments for documentation
COMMENT ON TABLE trade_history IS 'Audit trail for all pair trade strategy executions';
COMMENT ON COLUMN trade_history.trade_type IS 'Type of trade: initial_allocation or signal_trade';
COMMENT ON COLUMN trade_history.signal_data IS 'JSON data of the original signal that triggered this trade';
COMMENT ON COLUMN trade_history.slippage_bps IS 'Slippage tolerance in basis points (1% = 100 bps)';
COMMENT ON COLUMN trade_history.percentage_traded IS 'Percentage of holdings that were traded';