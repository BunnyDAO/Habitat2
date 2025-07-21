-- Migration: Create strategy_holdings table for pair trade tracking
CREATE TABLE IF NOT EXISTS strategy_holdings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id integer NOT NULL,
    token_a_mint varchar(44) NOT NULL,
    token_a_amount bigint NOT NULL DEFAULT 0,
    token_b_mint varchar(44) NOT NULL,  
    token_b_amount bigint NOT NULL DEFAULT 0,
    total_allocated_sol bigint NOT NULL DEFAULT 0,
    last_updated timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    
    CONSTRAINT fk_strategy_holdings_strategy FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_strategy_holdings_strategy_id ON strategy_holdings(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_holdings_last_updated ON strategy_holdings(last_updated);

-- Add trigger to update last_updated on changes
CREATE OR REPLACE FUNCTION update_strategy_holdings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trigger_update_strategy_holdings_timestamp
    BEFORE UPDATE ON strategy_holdings
    FOR EACH ROW
    EXECUTE FUNCTION update_strategy_holdings_timestamp();