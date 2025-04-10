-- Add UI amount and USD value columns
ALTER TABLE wallet_balances 
    ADD COLUMN ui_amount DECIMAL(20, 10),
    ADD COLUMN usd_value DECIMAL(20, 2);

-- Update existing rows to populate ui_amount based on amount and token decimals
UPDATE wallet_balances wb
SET ui_amount = wb.amount / POWER(10, t.decimals)
FROM tokens t
WHERE wb.mint_address = t.mint_address;

-- Add foreign key constraint to trading_wallets
-- First, clean up any orphaned records
DELETE FROM wallet_balances wb
WHERE NOT EXISTS (
    SELECT 1 FROM trading_wallets tw 
    WHERE tw.wallet_pubkey = wb.wallet_address
);

-- Then add the constraint
ALTER TABLE wallet_balances 
    ADD CONSTRAINT fk_wallet_balances_trading_wallet
    FOREIGN KEY (wallet_address) 
    REFERENCES trading_wallets(wallet_pubkey)
    ON DELETE CASCADE;

-- Add index for last_updated
CREATE INDEX IF NOT EXISTS idx_wallet_balances_last_updated 
    ON wallet_balances(last_updated);

-- Update the wallet_portfolio_view to use the new columns
DROP VIEW IF EXISTS wallet_portfolio_view;
CREATE OR REPLACE VIEW wallet_portfolio_view AS
SELECT 
    wb.wallet_address,
    wb.mint_address,
    t.name,
    t.symbol,
    t.logo_uri,
    wb.amount,
    wb.ui_amount,
    wb.usd_value,
    tp.current_price_usd,
    tp.price_change_24h,
    tp.volume_24h_usd,
    tp.liquidity_usd,
    wb.usd_value as portfolio_value,
    CASE 
        WHEN SUM(wb.usd_value) OVER (PARTITION BY wb.wallet_address) > 0 
        THEN (wb.usd_value / SUM(wb.usd_value) OVER (PARTITION BY wb.wallet_address)) * 100 
        ELSE 0 
    END as portfolio_percentage
FROM wallet_balances wb
JOIN tokens t ON wb.mint_address = t.mint_address
LEFT JOIN token_prices tp ON wb.mint_address = tp.mint_address; 