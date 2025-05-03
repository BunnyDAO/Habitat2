-- Create table for storing encrypted wallet keys
CREATE TABLE encrypted_wallet_keys (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(44) NOT NULL REFERENCES users(main_wallet_pubkey) ON DELETE CASCADE,
    trading_wallet_id INTEGER NOT NULL REFERENCES trading_wallets(id) ON DELETE CASCADE,
    session_key_encrypted TEXT NOT NULL,  -- encrypted with APP_SECRET
    wallet_keys_encrypted TEXT NOT NULL,  -- encrypted with session key
    last_used TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    version INTEGER DEFAULT 1,
    UNIQUE(trading_wallet_id),
    CONSTRAINT fk_user_wallet FOREIGN KEY (user_id) REFERENCES users(main_wallet_pubkey),
    CONSTRAINT fk_trading_wallet FOREIGN KEY (trading_wallet_id) REFERENCES trading_wallets(id)
);

-- Create audit table for key operations
CREATE TABLE key_operations_audit (
    id SERIAL PRIMARY KEY,
    encrypted_key_id INTEGER REFERENCES encrypted_wallet_keys(id) ON DELETE SET NULL,
    operation_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    error_message TEXT,
    performed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB,
    CONSTRAINT fk_encrypted_key FOREIGN KEY (encrypted_key_id) REFERENCES encrypted_wallet_keys(id)
);

-- Add indexes for performance
CREATE INDEX idx_encrypted_wallet_keys_user ON encrypted_wallet_keys(user_id);
CREATE INDEX idx_encrypted_wallet_keys_trading_wallet ON encrypted_wallet_keys(trading_wallet_id);
CREATE INDEX idx_encrypted_wallet_keys_active ON encrypted_wallet_keys(is_active);
CREATE INDEX idx_key_operations_audit_key ON key_operations_audit(encrypted_key_id);
CREATE INDEX idx_key_operations_audit_type ON key_operations_audit(operation_type);

-- Add comments
COMMENT ON TABLE encrypted_wallet_keys IS 'Stores encrypted wallet keys for automated trading';
COMMENT ON TABLE key_operations_audit IS 'Audit trail for all key operations';
COMMENT ON COLUMN encrypted_wallet_keys.user_id IS 'Reference to the main wallet public key';
COMMENT ON COLUMN encrypted_wallet_keys.trading_wallet_id IS 'Reference to the trading wallet ID';
COMMENT ON COLUMN key_operations_audit.encrypted_key_id IS 'Reference to the encrypted wallet key ID';

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_encrypted_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
CREATE TRIGGER update_encrypted_keys_updated_at
    BEFORE UPDATE ON encrypted_wallet_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_encrypted_keys_updated_at(); 
