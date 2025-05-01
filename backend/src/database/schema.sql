-- Drop existing tables and views
DROP VIEW IF EXISTS wallet_portfolio_view;
DROP TABLE IF EXISTS wallet_balances CASCADE;
DROP TABLE IF EXISTS token_prices CASCADE;
DROP TABLE IF EXISTS tokens CASCADE;
DROP TABLE IF EXISTS transactions_archive CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS strategies CASCADE;
DROP TABLE IF EXISTS trading_wallets CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Create users table first
CREATE TABLE users (
    main_wallet_pubkey VARCHAR(44) PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create tokens table for metadata
CREATE TABLE tokens (
    mint_address TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    logo_uri TEXT,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create token_prices table
CREATE TABLE token_prices (
    mint_address TEXT PRIMARY KEY REFERENCES tokens(mint_address),
    current_price_usd DECIMAL(20, 10),
    price_5m_usd DECIMAL(20, 10),
    price_1h_usd DECIMAL(20, 10),
    price_6h_usd DECIMAL(20, 10),
    price_24h_usd DECIMAL(20, 10),
    price_change_5m DECIMAL(10, 4),
    price_change_1h DECIMAL(10, 4),
    price_change_6h DECIMAL(10, 4),
    price_change_24h DECIMAL(10, 4),
    volume_24h_usd DECIMAL(24, 2),
    liquidity_usd DECIMAL(24, 2),
    market_cap_usd DECIMAL(24, 2),
    market_cap_fdv_usd DECIMAL(24, 2),
    total_supply DECIMAL(30, 0),
    circulating_supply DECIMAL(30, 0),
    token_age_days INTEGER,
    holder_count INTEGER,
    first_listed_date TIMESTAMP,
    last_trade_date TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create trading_wallets table
CREATE TABLE trading_wallets (
    id SERIAL,
    main_wallet_pubkey VARCHAR(44) REFERENCES users(main_wallet_pubkey) ON DELETE CASCADE,
    wallet_pubkey VARCHAR(44) NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE (wallet_pubkey)
);

-- Create strategies table with versioning
CREATE TABLE strategies (
    id SERIAL PRIMARY KEY,
    trading_wallet_id INTEGER REFERENCES trading_wallets(id) ON DELETE CASCADE,
    main_wallet_pubkey VARCHAR(44) REFERENCES users(main_wallet_pubkey) ON DELETE CASCADE,
    strategy_type VARCHAR(50) NOT NULL,
    config JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    name VARCHAR(255),
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (trading_wallet_id, strategy_type)
);

-- Create strategy_versions table for version history
CREATE TABLE strategy_versions (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    config JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(44) REFERENCES users(main_wallet_pubkey),
    change_reason TEXT
);

-- Create wallet_balances table
CREATE TABLE wallet_balances (
    id SERIAL PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    mint_address TEXT REFERENCES tokens(mint_address),
    amount DECIMAL(20, 10) NOT NULL,
    ui_amount DECIMAL(20, 10),
    usd_value DECIMAL(20, 2),
    decimals INTEGER NOT NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(wallet_address, mint_address)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_wallet_balances_wallet ON wallet_balances(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_balances_mint ON wallet_balances(mint_address);
CREATE INDEX IF NOT EXISTS idx_wallet_balances_last_updated ON wallet_balances(last_updated);
CREATE INDEX IF NOT EXISTS idx_token_prices_updated ON token_prices(last_updated);
CREATE INDEX IF NOT EXISTS idx_token_prices_volume ON token_prices(volume_24h_usd);
CREATE INDEX IF NOT EXISTS idx_token_prices_mcap ON token_prices(market_cap_usd);
CREATE INDEX IF NOT EXISTS idx_token_prices_liquidity ON token_prices(liquidity_usd);
CREATE INDEX IF NOT EXISTS idx_trading_wallets_main_wallet ON trading_wallets(main_wallet_pubkey);

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

-- Create main transactions table with partitioning support
CREATE TABLE transactions (
    id SERIAL,
    trading_wallet_id INTEGER REFERENCES trading_wallets(id) ON DELETE CASCADE,
    main_wallet_pubkey VARCHAR(44) REFERENCES users(main_wallet_pubkey) ON DELETE CASCADE,
    wallet_pubkey VARCHAR(44) REFERENCES trading_wallets(wallet_pubkey) ON DELETE CASCADE,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE SET NULL,
    signature VARCHAR(88) NOT NULL,
    type VARCHAR(10) NOT NULL,
    amount DECIMAL(20, 9) NOT NULL,
    token_mint VARCHAR(44) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, timestamp),
    UNIQUE (signature, timestamp)
) PARTITION BY RANGE (timestamp);

-- Create partitions for transactions table (example: monthly partitions)
CREATE TABLE transactions_y2023m01 PARTITION OF transactions
    FOR VALUES FROM ('2023-01-01') TO ('2023-02-01');
CREATE TABLE transactions_y2023m02 PARTITION OF transactions
    FOR VALUES FROM ('2023-02-01') TO ('2023-03-01');
-- Add more partitions as needed...

-- Create archive table for old transactions (without inheritance)
CREATE TABLE transactions_archive (
    id SERIAL,
    trading_wallet_id INTEGER REFERENCES trading_wallets(id) ON DELETE CASCADE,
    main_wallet_pubkey VARCHAR(44) REFERENCES users(main_wallet_pubkey) ON DELETE CASCADE,
    wallet_pubkey VARCHAR(44) REFERENCES trading_wallets(wallet_pubkey) ON DELETE CASCADE,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE SET NULL,
    signature VARCHAR(88) NOT NULL,
    type VARCHAR(10) NOT NULL,
    amount DECIMAL(20, 9) NOT NULL,
    token_mint VARCHAR(44) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    archived_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, timestamp),
    UNIQUE (signature, timestamp)
);

-- Create indexes for archive table
CREATE INDEX idx_transactions_archive_timestamp ON transactions_archive(timestamp);
CREATE INDEX idx_transactions_archive_trading_wallet_id ON transactions_archive(trading_wallet_id);
CREATE INDEX idx_transactions_archive_strategy_id ON transactions_archive(strategy_id);
CREATE INDEX idx_transactions_archive_token_mint ON transactions_archive(token_mint);
CREATE INDEX idx_transactions_archive_type ON transactions_archive(type);

-- Create materialized view for daily transaction summaries
CREATE MATERIALIZED VIEW daily_transaction_summaries AS
SELECT 
    trading_wallet_id,
    DATE_TRUNC('day', timestamp) as day,
    token_mint,
    COUNT(*) as transaction_count,
    SUM(CASE WHEN type = 'buy' THEN amount ELSE 0 END) as total_buy_amount,
    SUM(CASE WHEN type = 'sell' THEN amount ELSE 0 END) as total_sell_amount,
    MIN(timestamp) as first_transaction,
    MAX(timestamp) as last_transaction
FROM transactions
GROUP BY trading_wallet_id, DATE_TRUNC('day', timestamp), token_mint;

-- Create function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_daily_summaries()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_transaction_summaries;
END;
$$ LANGUAGE plpgsql;

-- Create function to archive old transactions
CREATE OR REPLACE FUNCTION archive_old_transactions(older_than_months INTEGER)
RETURNS void AS $$
BEGIN
    INSERT INTO transactions_archive
    SELECT * FROM transactions
    WHERE timestamp < NOW() - (older_than_months || ' months')::INTERVAL;
    
    DELETE FROM transactions
    WHERE timestamp < NOW() - (older_than_months || ' months')::INTERVAL;
END;
$$ LANGUAGE plpgsql;

-- Create function to automatically create new partitions
CREATE OR REPLACE FUNCTION create_transaction_partition(partition_date DATE)
RETURNS void AS $$
DECLARE
    partition_name TEXT;
    partition_start DATE;
    partition_end DATE;
BEGIN
    partition_name := 'transactions_y' || 
                     TO_CHAR(partition_date, 'YYYY') || 'm' || 
                     TO_CHAR(partition_date, 'MM');
    
    partition_start := DATE_TRUNC('month', partition_date);
    partition_end := partition_start + INTERVAL '1 month';
    
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF transactions
         FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        partition_start,
        partition_end
    );
END;
$$ LANGUAGE plpgsql;

-- Create trigger function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trading_wallets_updated_at
    BEFORE UPDATE ON trading_wallets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_strategies_updated_at
    BEFORE UPDATE ON strategies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create index for versioning
CREATE INDEX idx_strategy_versions_strategy_id ON strategy_versions(strategy_id);
CREATE INDEX idx_strategy_versions_version ON strategy_versions(version);

-- Add trigger to automatically create version history
CREATE OR REPLACE FUNCTION create_strategy_version()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        INSERT INTO strategy_versions (
            strategy_id,
            version,
            config,
            created_by,
            change_reason
        ) VALUES (
            NEW.id,
            NEW.version,
            NEW.config,
            NEW.main_wallet_pubkey,
            NEW.change_reason
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER strategy_version_trigger
    AFTER UPDATE ON strategies
    FOR EACH ROW
    EXECUTE FUNCTION create_strategy_version(); 