-- Migration: Add Enhanced Levels Trading System Support
-- Created: 2025-01-22
-- Purpose: Add new columns to strategies table to support BUY/SELL modes and enhanced configuration

-- Add new columns to strategies table for enhanced levels support
ALTER TABLE strategies 
ADD COLUMN IF NOT EXISTS strategy_mode VARCHAR(10) CHECK (strategy_mode IN ('buy', 'sell')),
ADD COLUMN IF NOT EXISTS auto_restart_after_complete BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS cooldown_hours INTEGER DEFAULT 24,
ADD COLUMN IF NOT EXISTS max_retriggers INTEGER DEFAULT 3;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_strategies_mode ON strategies(strategy_mode);
CREATE INDEX IF NOT EXISTS idx_strategies_auto_restart ON strategies(auto_restart_after_complete);

-- Add comments to explain the new columns
COMMENT ON COLUMN strategies.strategy_mode IS 'Trading mode for levels strategy: buy (accumulate SOL) or sell (convert to USDC)';
COMMENT ON COLUMN strategies.auto_restart_after_complete IS 'Whether to automatically restart strategy after all levels complete';
COMMENT ON COLUMN strategies.cooldown_hours IS 'Hours to wait before a level can retrigger after execution';
COMMENT ON COLUMN strategies.max_retriggers IS 'Maximum times a level can execute before being permanently disabled';