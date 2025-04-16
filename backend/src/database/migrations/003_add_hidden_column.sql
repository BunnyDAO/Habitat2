-- Add hidden column to wallet_balances table
ALTER TABLE wallet_balances 
    ADD COLUMN hidden BOOLEAN DEFAULT false;

-- Create index for hidden column
CREATE INDEX IF NOT EXISTS idx_wallet_balances_hidden 
    ON wallet_balances(hidden);

-- Update the wallet_portfolio_view to include hidden status
DROP VIEW IF EXISTS wallet_portfolio_view;
CREATE OR REPLACE VIEW wallet_portfolio_view AS
SELECT 
    wb.wallet_address,
    wb.mint_address,
    t.name,
    t.symbol,
    t.logo_uri,
    wb.amount,
    wb.amount / POWER(10, t.decimals) as ui_amount,
    wb.amount / POWER(10, t.decimals) * COALESCE(tp.current_price_usd, 0) as usd_value,
    wb.hidden,
    tp.current_price_usd,
    tp.price_change_24h,
    tp.volume_24h_usd,
    tp.liquidity_usd,
    wb.amount / POWER(10, t.decimals) * COALESCE(tp.current_price_usd, 0) as portfolio_value,
    CASE 
        WHEN SUM(wb.amount / POWER(10, t.decimals) * COALESCE(tp.current_price_usd, 0)) OVER (PARTITION BY wb.wallet_address) > 0 
        THEN (wb.amount / POWER(10, t.decimals) * COALESCE(tp.current_price_usd, 0) / SUM(wb.amount / POWER(10, t.decimals) * COALESCE(tp.current_price_usd, 0)) OVER (PARTITION BY wb.wallet_address)) * 100 
        ELSE 0 
    END as portfolio_percentage
FROM wallet_balances wb
JOIN tokens t ON wb.mint_address = t.mint_address
LEFT JOIN token_prices tp ON wb.mint_address = tp.mint_address; 