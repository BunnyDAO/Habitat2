-- Migration: Add pair_trade_triggers table
-- Date: 2025-07-22
-- Purpose: Manual trigger system for pair trades

CREATE TABLE pair_trade_triggers (
  id SERIAL PRIMARY KEY,
  token_a_mint VARCHAR(64) NOT NULL,
  token_b_mint VARCHAR(64) NOT NULL,
  token_a_symbol VARCHAR(10) NOT NULL,
  token_b_symbol VARCHAR(10) NOT NULL,
  
  -- Trading direction and triggers
  preferred_initial_token CHAR(1) NOT NULL CHECK (preferred_initial_token IN ('A', 'B')),
  current_direction VARCHAR(10) CHECK (current_direction IN ('A_TO_B', 'B_TO_A', 'HOLD')),
  trigger_swap BOOLEAN DEFAULT false,
  
  -- Tracking
  last_triggered_at TIMESTAMP,
  trigger_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Ensure unique pair (either direction)
  UNIQUE(token_a_mint, token_b_mint)
);

-- Create index for faster lookups
CREATE INDEX idx_pair_trade_triggers_active ON pair_trade_triggers (trigger_swap, current_direction) WHERE trigger_swap = true;

-- Insert default configurations for common pairs
INSERT INTO pair_trade_triggers (
  token_a_mint, token_b_mint, token_a_symbol, token_b_symbol, 
  preferred_initial_token, current_direction, trigger_swap
) VALUES 
  -- SOL/USDC pair - prefer starting with USDC (stable)
  ('So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'SOL', 'USDC', 'B', 'HOLD', false),
  
  -- Add more pairs as needed - examples:
  -- ('TSLAx_MINT_ADDRESS', '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', 'TSLAx', 'wBTC', 'A', 'HOLD', false),
  -- ('AAPLx_MINT_ADDRESS', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'AAPLx', 'USDC', 'A', 'HOLD', false),
  
  -- Placeholder for demonstration - replace with actual mint addresses
  ('DEMO_TOKEN_A_MINT', 'DEMO_TOKEN_B_MINT', 'DEMO_A', 'DEMO_B', 'A', 'HOLD', false)
ON CONFLICT (token_a_mint, token_b_mint) DO NOTHING;

-- Add trigger for auto-updating updated_at timestamp
CREATE OR REPLACE FUNCTION update_pair_trade_triggers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trigger_pair_trade_triggers_updated_at
  BEFORE UPDATE ON pair_trade_triggers
  FOR EACH ROW
  EXECUTE FUNCTION update_pair_trade_triggers_updated_at();

-- Add comments for documentation
COMMENT ON TABLE pair_trade_triggers IS 'Manual trigger system for pair trade strategies';
COMMENT ON COLUMN pair_trade_triggers.preferred_initial_token IS 'A or B - which token to hold initially when strategy starts';
COMMENT ON COLUMN pair_trade_triggers.current_direction IS 'A_TO_B, B_TO_A, or HOLD - current swap direction to execute';
COMMENT ON COLUMN pair_trade_triggers.trigger_swap IS 'Boolean flag - true triggers daemon to execute swaps, auto-resets to false';
COMMENT ON COLUMN pair_trade_triggers.last_triggered_at IS 'Timestamp of last daemon execution';
COMMENT ON COLUMN pair_trade_triggers.trigger_count IS 'Total number of times this trigger has been executed';