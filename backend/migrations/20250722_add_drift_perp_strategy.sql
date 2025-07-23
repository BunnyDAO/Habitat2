-- Migration: Add Drift Perpetual trading strategy support
-- Date: 2025-07-22
-- Purpose: Enable perpetual futures trading via Drift Protocol

-- Create Drift perp markets reference table
CREATE TABLE drift_perp_markets (
  id SERIAL PRIMARY KEY,
  market_index INTEGER UNIQUE NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  base_asset_symbol VARCHAR(10) NOT NULL,
  quote_asset_symbol VARCHAR(10) DEFAULT 'USD',
  
  -- Market configuration
  min_order_size DECIMAL(20, 8) NOT NULL,
  tick_size DECIMAL(20, 8) NOT NULL,
  step_size DECIMAL(20, 8) NOT NULL,
  max_leverage INTEGER DEFAULT 10,
  
  -- Market status
  is_active BOOLEAN DEFAULT true,
  is_trading_enabled BOOLEAN DEFAULT true,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default Drift perpetual markets
INSERT INTO drift_perp_markets (market_index, symbol, base_asset_symbol, min_order_size, tick_size, step_size, max_leverage) VALUES
  (0, 'SOL-PERP', 'SOL', 0.1, 0.01, 0.1, 20),
  (1, 'BTC-PERP', 'BTC', 0.001, 1.0, 0.001, 20),
  (2, 'ETH-PERP', 'ETH', 0.01, 0.1, 0.01, 20),
  (3, 'APT-PERP', 'APT', 1.0, 0.001, 1.0, 10),
  (4, 'JUP-PERP', 'JUP', 10.0, 0.0001, 10.0, 10),
  (5, 'PYTH-PERP', 'PYTH', 10.0, 0.0001, 10.0, 10),
  (6, 'JTO-PERP', 'JTO', 1.0, 0.001, 1.0, 10),
  (7, 'WIF-PERP', 'WIF', 1.0, 0.0001, 1.0, 10),
  (8, 'BONK-PERP', 'BONK', 1000.0, 0.000001, 1000.0, 10),
  (9, 'AVAX-PERP', 'AVAX', 0.1, 0.01, 0.1, 10);

-- Add Drift Perp job type to jobs table data validation
-- Note: This assumes you have a check constraint or enum for job types
-- ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;
-- ALTER TABLE jobs ADD CONSTRAINT jobs_type_check 
--   CHECK (type IN ('wallet-monitor', 'price-monitor', 'vault', 'levels', 'pair-trade', 'drift-perp'));

-- Create indexes for performance
CREATE INDEX idx_drift_perp_markets_symbol ON drift_perp_markets(symbol);
CREATE INDEX idx_drift_perp_markets_active ON drift_perp_markets(is_active, is_trading_enabled);
CREATE INDEX idx_drift_perp_markets_base_asset ON drift_perp_markets(base_asset_symbol);

-- Add trigger for auto-updating updated_at timestamp
CREATE OR REPLACE FUNCTION update_drift_perp_markets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trigger_drift_perp_markets_updated_at
  BEFORE UPDATE ON drift_perp_markets
  FOR EACH ROW
  EXECUTE FUNCTION update_drift_perp_markets_updated_at();

-- Add comments for documentation
COMMENT ON TABLE drift_perp_markets IS 'Reference table for available Drift Protocol perpetual futures markets';
COMMENT ON COLUMN drift_perp_markets.market_index IS 'Drift Protocol market index identifier';
COMMENT ON COLUMN drift_perp_markets.symbol IS 'Trading pair symbol (e.g., SOL-PERP)';
COMMENT ON COLUMN drift_perp_markets.min_order_size IS 'Minimum order size for this market';
COMMENT ON COLUMN drift_perp_markets.tick_size IS 'Minimum price increment';
COMMENT ON COLUMN drift_perp_markets.step_size IS 'Minimum size increment';
COMMENT ON COLUMN drift_perp_markets.max_leverage IS 'Maximum allowed leverage for this market';

-- Create view for active markets with current prices (to be updated by price feed)
CREATE OR REPLACE VIEW active_drift_markets AS
SELECT 
  m.*,
  COALESCE(p.current_price, 0) as current_price,
  COALESCE(p.price_change_24h, 0) as price_change_24h,
  COALESCE(p.last_updated, NOW() - INTERVAL '1 hour') as price_last_updated
FROM drift_perp_markets m
LEFT JOIN (
  -- This would be populated by a price feed service
  -- For now, we'll create a placeholder structure
  SELECT 
    market_index,
    0.0 as current_price,
    0.0 as price_change_24h,
    NOW() as last_updated
  FROM drift_perp_markets
  LIMIT 0  -- Empty result set for now
) p ON m.market_index = p.market_index
WHERE m.is_active = true AND m.is_trading_enabled = true
ORDER BY m.symbol;