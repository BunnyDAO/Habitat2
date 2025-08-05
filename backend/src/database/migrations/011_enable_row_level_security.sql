-- Migration 011: Enable Row Level Security
-- Created: 2025-01-04
-- Purpose: Enable RLS on critical tables to prevent unauthorized access

-- Enable RLS on critical user data tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE encrypted_wallet_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_balances ENABLE ROW LEVEL SECURITY;

-- Users can only access their own data
CREATE POLICY "Users can only access their own records" ON users
    FOR ALL USING (main_wallet_pubkey = current_setting('app.current_user_wallet')::text);

-- Trading wallets - users can only access wallets they own
CREATE POLICY "Users can only access their own trading wallets" ON trading_wallets
    FOR ALL USING (main_wallet_pubkey = current_setting('app.current_user_wallet')::text);

-- Encrypted keys - users can only access their own wallet keys
CREATE POLICY "Users can only access their own encrypted keys" ON encrypted_wallet_keys
    FOR ALL USING (trading_wallet_id IN (
        SELECT id FROM trading_wallets 
        WHERE main_wallet_pubkey = current_setting('app.current_user_wallet')::text
    ));

-- Strategies - users can only access their own strategies
CREATE POLICY "Users can only access their own strategies" ON strategies
    FOR ALL USING (main_wallet_pubkey = current_setting('app.current_user_wallet')::text);

-- Wallet balances - users can only access balances for their wallets
CREATE POLICY "Users can only access their own wallet balances" ON wallet_balances
    FOR ALL USING (wallet_address IN (
        SELECT wallet_pubkey FROM trading_wallets 
        WHERE main_wallet_pubkey = current_setting('app.current_user_wallet')::text
    ));

-- Auth tables can be more permissive for service functionality
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can access their own auth sessions" ON auth_sessions
    FOR ALL USING (wallet_address = current_setting('app.current_user_wallet')::text);

-- Audit logs - users can see their own actions
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;  
CREATE POLICY "Users can see their own audit logs" ON audit_logs
    FOR SELECT USING (wallet_address = current_setting('app.current_user_wallet')::text);

-- API rate limits - allow service to manage these
-- (Keep unrestricted for backend service functionality)

-- Security incidents - admin only
ALTER TABLE security_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deny all access to security incidents" ON security_incidents
    FOR ALL USING (false); -- Only superuser/service can access

COMMENT ON MIGRATION IS 'Enables Row Level Security to ensure users can only access their own data'; 