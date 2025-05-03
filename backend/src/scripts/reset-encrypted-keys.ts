import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function resetEncryptedKeys() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Drop tables in correct order
      console.log('Dropping key_operations_audit table...');
      await client.query('DROP TABLE IF EXISTS key_operations_audit');

      console.log('Dropping encrypted_wallet_keys table...');
      await client.query('DROP TABLE IF EXISTS encrypted_wallet_keys');

      // Create tables in correct order
      console.log('Creating encrypted_wallet_keys table...');
      await client.query(`
        CREATE TABLE encrypted_wallet_keys (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(44) REFERENCES users(main_wallet_pubkey) ON DELETE CASCADE,
          trading_wallet_id INTEGER REFERENCES trading_wallets(id) ON DELETE CASCADE,
          session_key_encrypted TEXT NOT NULL,  -- encrypted with APP_SECRET
          wallet_keys_encrypted TEXT NOT NULL,  -- encrypted with session key
          last_used TIMESTAMP WITH TIME ZONE,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          version INTEGER DEFAULT 1,
          UNIQUE(trading_wallet_id)
        )
      `);

      console.log('Creating key_operations_audit table...');
      await client.query(`
        CREATE TABLE key_operations_audit (
          id SERIAL PRIMARY KEY,
          encrypted_key_id INTEGER NULL,
          operation_type VARCHAR(50) NOT NULL,
          status VARCHAR(20) NOT NULL,
          error_message TEXT,
          performed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          metadata JSONB,
          FOREIGN KEY (encrypted_key_id) REFERENCES encrypted_wallet_keys(id) ON DELETE CASCADE
        )
      `);

      // Add indexes
      console.log('Creating indexes...');
      await client.query(`
        CREATE INDEX idx_encrypted_wallet_keys_user ON encrypted_wallet_keys(user_id);
        CREATE INDEX idx_encrypted_wallet_keys_trading_wallet ON encrypted_wallet_keys(trading_wallet_id);
        CREATE INDEX idx_encrypted_wallet_keys_active ON encrypted_wallet_keys(is_active);
        CREATE INDEX idx_key_operations_audit_key ON key_operations_audit(encrypted_key_id);
        CREATE INDEX idx_key_operations_audit_type ON key_operations_audit(operation_type);
      `);

      // Add comments
      console.log('Adding comments...');
      await client.query(`
        COMMENT ON TABLE encrypted_wallet_keys IS 'Stores encrypted wallet keys for automated trading';
        COMMENT ON TABLE key_operations_audit IS 'Audit trail for all key operations';
      `);

      // Create function to update updated_at timestamp
      console.log('Creating update_encrypted_keys_updated_at function...');
      await client.query(`
        CREATE OR REPLACE FUNCTION update_encrypted_keys_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      await client.query('COMMIT');
      console.log('Successfully reset encrypted keys tables');

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error resetting encrypted keys tables:', error);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error connecting to database:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  resetEncryptedKeys().catch(console.error);
} 