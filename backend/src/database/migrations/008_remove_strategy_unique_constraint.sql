-- Remove unique constraint to allow multiple strategies of same type per trading wallet
-- This enables the application logic to handle duplicates based on configuration

-- First, check if the constraint exists and remove it
DO $$
BEGIN
    -- Check if the unique constraint exists
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'unique_wallet_strategy_type'
    ) THEN
        -- Drop the constraint
        ALTER TABLE strategies DROP CONSTRAINT unique_wallet_strategy_type;
        RAISE NOTICE 'Dropped unique_wallet_strategy_type constraint';
    ELSE
        RAISE NOTICE 'Constraint unique_wallet_strategy_type does not exist, skipping';
    END IF;
    
    -- Also check for the old constraint from schema.sql
    IF EXISTS (
        SELECT 1 FROM pg_constraint con
        INNER JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'strategies'
        AND con.contype = 'u'
        AND EXISTS (
            SELECT 1 FROM pg_attribute attr
            WHERE attr.attrelid = con.conrelid
            AND attr.attnum = ANY(con.conkey)
            AND attr.attname IN ('trading_wallet_id', 'strategy_type')
        )
        AND array_length(con.conkey, 1) = 2
    ) THEN
        -- Find and drop the old constraint
        DECLARE
            constraint_name TEXT;
        BEGIN
            SELECT con.conname INTO constraint_name
            FROM pg_constraint con
            INNER JOIN pg_class rel ON rel.oid = con.conrelid
            WHERE rel.relname = 'strategies'
            AND con.contype = 'u'
            AND EXISTS (
                SELECT 1 FROM pg_attribute attr
                WHERE attr.attrelid = con.conrelid
                AND attr.attnum = ANY(con.conkey)
                AND attr.attname IN ('trading_wallet_id', 'strategy_type')
            )
            AND array_length(con.conkey, 1) = 2
            LIMIT 1;
            
            IF constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE strategies DROP CONSTRAINT ' || constraint_name;
                RAISE NOTICE 'Dropped old unique constraint: %', constraint_name;
            END IF;
        END;
    ELSE
        RAISE NOTICE 'No old unique constraint found on (trading_wallet_id, strategy_type)';
    END IF;
END $$;

-- Add index for performance on the combination (non-unique)
CREATE INDEX IF NOT EXISTS idx_strategies_wallet_type 
ON strategies(trading_wallet_id, strategy_type);

-- Add comment explaining the change
COMMENT ON TABLE strategies IS 'Strategies table - allows multiple strategies of same type per trading wallet, with application-level duplicate handling based on configuration';
