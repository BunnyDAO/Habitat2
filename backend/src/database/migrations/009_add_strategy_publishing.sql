-- Migration 009: Add Strategy Publishing and Marketplace Tables
-- Created: 2025-01-07
-- Purpose: Enable strategy publishing and marketplace functionality

-- Create published_strategies table
CREATE TABLE published_strategies (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    publisher_wallet VARCHAR(44) REFERENCES users(main_wallet_pubkey),
    
    -- Publishing Details
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    tags VARCHAR(255)[], -- Array of searchable tags
    
    -- Requirements
    required_wallets INTEGER NOT NULL CHECK (required_wallets >= 1 AND required_wallets <= 3),
    min_balance_sol DECIMAL(10,4) DEFAULT 0, -- Minimum SOL required to run
    
    -- Pricing (Future: could enable paid strategies)
    price_sol DECIMAL(10,4) DEFAULT 0,
    is_free BOOLEAN DEFAULT true,
    
    -- Performance Metrics
    total_roi_percentage DECIMAL(10,4),
    avg_daily_return DECIMAL(10,4),
    max_drawdown DECIMAL(10,4),
    total_trades INTEGER DEFAULT 0,
    win_rate DECIMAL(5,2), -- Percentage of winning trades
    
    -- Marketplace Stats
    downloads INTEGER DEFAULT 0,
    rating DECIMAL(3,2) DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false, -- Admin verification
    
    -- Timestamps
    published_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create strategy_adoptions table
CREATE TABLE strategy_adoptions (
    id SERIAL PRIMARY KEY,
    published_strategy_id INTEGER REFERENCES published_strategies(id) ON DELETE CASCADE,
    adopter_wallet VARCHAR(44) REFERENCES users(main_wallet_pubkey),
    
    -- Adoption Details
    adopted_strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    wallet_mapping JSONB NOT NULL, -- Maps original wallet positions to user's wallets
    
    -- Customization
    custom_config JSONB, -- User modifications to original config
    is_modified BOOLEAN DEFAULT false,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    -- Timestamps
    adopted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_modified TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create strategy_reviews table
CREATE TABLE strategy_reviews (
    id SERIAL PRIMARY KEY,
    published_strategy_id INTEGER REFERENCES published_strategies(id) ON DELETE CASCADE,
    reviewer_wallet VARCHAR(44) REFERENCES users(main_wallet_pubkey),
    adoption_id INTEGER REFERENCES strategy_adoptions(id) ON DELETE CASCADE,
    
    -- Review Content
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    review_text TEXT,
    
    -- Review Metrics (from actual usage)
    used_duration_days INTEGER,
    actual_roi_percentage DECIMAL(10,4),
    recommendation_level INTEGER CHECK (recommendation_level >= 1 AND recommendation_level <= 5),
    
    -- Status
    is_verified BOOLEAN DEFAULT false, -- Verified actual usage
    is_visible BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Prevent duplicate reviews
    UNIQUE(published_strategy_id, reviewer_wallet)
);

-- Create strategy_performance_history table
CREATE TABLE strategy_performance_history (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    
    -- Daily Performance Metrics
    starting_balance_sol DECIMAL(20,8),
    ending_balance_sol DECIMAL(20,8),
    daily_return_sol DECIMAL(20,8),
    daily_return_percentage DECIMAL(10,4),
    
    -- USD Equivalent
    starting_balance_usd DECIMAL(20,8),
    ending_balance_usd DECIMAL(20,8),
    daily_return_usd DECIMAL(20,8),
    
    -- Trading Activity
    trades_executed INTEGER DEFAULT 0,
    successful_trades INTEGER DEFAULT 0,
    failed_trades INTEGER DEFAULT 0,
    
    -- Metrics
    max_drawdown DECIMAL(10,4),
    volatility DECIMAL(10,4),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint
    UNIQUE(strategy_id, date)
);

-- Create strategy_wallet_requirements table
CREATE TABLE strategy_wallet_requirements (
    id SERIAL PRIMARY KEY,
    published_strategy_id INTEGER REFERENCES published_strategies(id) ON DELETE CASCADE,
    
    -- Wallet Configuration
    wallet_position INTEGER NOT NULL CHECK (wallet_position >= 1 AND wallet_position <= 3),
    wallet_role VARCHAR(100) NOT NULL, -- 'primary', 'secondary', 'vault', etc.
    min_balance_sol DECIMAL(10,4) DEFAULT 0,
    description TEXT,
    
    -- Configuration Requirements
    required_tokens VARCHAR(44)[], -- Array of token mints required
    permissions VARCHAR(100)[], -- Array of required permissions
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint
    UNIQUE(published_strategy_id, wallet_position)
);

-- Create indexes for performance

-- Published strategies indexes
CREATE INDEX idx_published_strategies_active ON published_strategies(is_active, rating DESC);
CREATE INDEX idx_published_strategies_category ON published_strategies(category, is_active);
CREATE INDEX idx_published_strategies_publisher ON published_strategies(publisher_wallet);
CREATE INDEX idx_published_strategies_downloads ON published_strategies(downloads DESC);
CREATE INDEX idx_published_strategies_rating ON published_strategies(rating DESC);
CREATE INDEX idx_published_strategies_tags ON published_strategies USING GIN (tags);

-- Strategy adoptions indexes
CREATE INDEX idx_strategy_adoptions_adopter ON strategy_adoptions(adopter_wallet);
CREATE INDEX idx_strategy_adoptions_published ON strategy_adoptions(published_strategy_id);
CREATE INDEX idx_strategy_adoptions_active ON strategy_adoptions(is_active);

-- Strategy reviews indexes
CREATE INDEX idx_strategy_reviews_published ON strategy_reviews(published_strategy_id, rating DESC);
CREATE INDEX idx_strategy_reviews_reviewer ON strategy_reviews(reviewer_wallet);
CREATE INDEX idx_strategy_reviews_visible ON strategy_reviews(is_visible);

-- Strategy performance history indexes
CREATE INDEX idx_strategy_performance_date ON strategy_performance_history(date DESC);
CREATE INDEX idx_strategy_performance_strategy ON strategy_performance_history(strategy_id, date DESC);

-- Strategy wallet requirements indexes
CREATE INDEX idx_wallet_requirements_published ON strategy_wallet_requirements(published_strategy_id);

-- Add trigger to update last_updated timestamp
CREATE OR REPLACE FUNCTION update_last_updated_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_published_strategies_last_updated 
    BEFORE UPDATE ON published_strategies 
    FOR EACH ROW EXECUTE FUNCTION update_last_updated_column();

CREATE TRIGGER update_strategy_adoptions_last_modified 
    BEFORE UPDATE ON strategy_adoptions 
    FOR EACH ROW EXECUTE FUNCTION update_last_updated_column();

CREATE TRIGGER update_strategy_reviews_updated_at 
    BEFORE UPDATE ON strategy_reviews 
    FOR EACH ROW EXECUTE FUNCTION update_last_updated_column();

-- Add some useful views

-- View for published strategies with performance metrics
CREATE VIEW published_strategies_with_metrics AS
SELECT 
    ps.*,
    s.strategy_type,
    s.config,
    u.main_wallet_pubkey as publisher_name,
    COUNT(sa.id) as total_adoptions,
    AVG(sr.rating) as avg_rating,
    COUNT(sr.id) as total_reviews
FROM published_strategies ps
LEFT JOIN strategies s ON ps.strategy_id = s.id
LEFT JOIN users u ON ps.publisher_wallet = u.main_wallet_pubkey
LEFT JOIN strategy_adoptions sa ON ps.id = sa.published_strategy_id
LEFT JOIN strategy_reviews sr ON ps.id = sr.published_strategy_id AND sr.is_visible = true
WHERE ps.is_active = true
GROUP BY ps.id, s.strategy_type, s.config, u.main_wallet_pubkey;

-- View for strategy adoption statistics
CREATE VIEW strategy_adoption_stats AS
SELECT 
    ps.id as published_strategy_id,
    ps.title,
    ps.publisher_wallet,
    COUNT(sa.id) as total_adoptions,
    COUNT(CASE WHEN sa.is_active = true THEN 1 END) as active_adoptions,
    AVG(sr.rating) as avg_rating,
    COUNT(sr.id) as total_reviews,
    MAX(sa.adopted_at) as last_adopted_at
FROM published_strategies ps
LEFT JOIN strategy_adoptions sa ON ps.id = sa.published_strategy_id
LEFT JOIN strategy_reviews sr ON ps.id = sr.published_strategy_id AND sr.is_visible = true
GROUP BY ps.id, ps.title, ps.publisher_wallet;

-- Add comments for documentation
COMMENT ON TABLE published_strategies IS 'Stores published strategies available in the marketplace';
COMMENT ON TABLE strategy_adoptions IS 'Tracks when users adopt published strategies';
COMMENT ON TABLE strategy_reviews IS 'User reviews and ratings for published strategies';
COMMENT ON TABLE strategy_performance_history IS 'Historical performance data for strategies';
COMMENT ON TABLE strategy_wallet_requirements IS 'Defines wallet requirements for published strategies';

COMMENT ON COLUMN published_strategies.required_wallets IS 'Number of trading wallets required (1-3)';
COMMENT ON COLUMN published_strategies.tags IS 'Array of searchable tags for categorization';
COMMENT ON COLUMN strategy_adoptions.wallet_mapping IS 'JSON mapping of original wallet positions to user wallets';
COMMENT ON COLUMN strategy_reviews.actual_roi_percentage IS 'Actual ROI achieved by reviewer';
COMMENT ON COLUMN strategy_performance_history.daily_return_percentage IS 'Daily return as percentage';