-- Drop existing tables and views
DROP VIEW IF EXISTS wallet_portfolio_view;
DROP TABLE IF EXISTS wallet_balances CASCADE;
DROP TABLE IF EXISTS token_prices CASCADE;
DROP TABLE IF EXISTS tokens CASCADE;

-- Create tokens table for metadata
CREATE TABLE IF NOT EXISTS tokens (
    mint_address TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    logo_uri TEXT,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create token_prices table with comprehensive market data
CREATE TABLE IF NOT EXISTS token_prices (
    mint_address TEXT PRIMARY KEY REFERENCES tokens(mint_address),
    current_price_usd DECIMAL(20, 10),
    price_5m_usd DECIMAL(20, 10),
    price_1h_usd DECIMAL(20, 10),
    price_6h_usd DECIMAL(20, 10),
    price_24h_usd DECIMAL(20, 10),
    price_change_5m DECIMAL(10, 4),  -- Percentage change
    price_change_1h DECIMAL(10, 4),
    price_change_6h DECIMAL(10, 4),
    price_change_24h DECIMAL(10, 4),
    volume_24h_usd DECIMAL(24, 2),
    liquidity_usd DECIMAL(24, 2),
    market_cap_usd DECIMAL(24, 2),
    market_cap_fdv_usd DECIMAL(24, 2), -- Fully diluted valuation
    total_supply DECIMAL(30, 0),
    circulating_supply DECIMAL(30, 0),
    token_age_days INTEGER,
    holder_count INTEGER,
    first_listed_date TIMESTAMP,
    last_trade_date TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create wallet_balances table for raw balances
CREATE TABLE IF NOT EXISTS wallet_balances (
    id SERIAL PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    mint_address TEXT REFERENCES tokens(mint_address),
    amount DECIMAL(20, 10) NOT NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(wallet_address, mint_address)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_wallet_balances_wallet ON wallet_balances(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_balances_mint ON wallet_balances(mint_address);
CREATE INDEX IF NOT EXISTS idx_token_prices_updated ON token_prices(last_updated);
CREATE INDEX IF NOT EXISTS idx_token_prices_volume ON token_prices(volume_24h_usd);
CREATE INDEX IF NOT EXISTS idx_token_prices_mcap ON token_prices(market_cap_usd);
CREATE INDEX IF NOT EXISTS idx_token_prices_liquidity ON token_prices(liquidity_usd);

-- Create view for portfolio calculations
CREATE OR REPLACE VIEW wallet_portfolio_view AS
SELECT 
    wb.wallet_address,
    wb.mint_address,
    t.name,
    t.symbol,
    t.logo_uri,
    wb.amount,
    tp.current_price_usd,
    tp.price_change_24h,
    tp.volume_24h_usd,
    tp.liquidity_usd,
    (wb.amount * tp.current_price_usd) as usd_value,
    (wb.amount * tp.current_price_usd) / 
        NULLIF(SUM(wb.amount * tp.current_price_usd) OVER (PARTITION BY wb.wallet_address), 0) * 100 
        as portfolio_percentage
FROM wallet_balances wb
JOIN tokens t ON wb.mint_address = t.mint_address
LEFT JOIN token_prices tp ON wb.mint_address = tp.mint_address; 