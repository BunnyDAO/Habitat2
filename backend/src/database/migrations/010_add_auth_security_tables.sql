-- Migration 010: Add Authentication Security Tables
-- Created: 2025-01-07
-- Purpose: Add tables for secure authentication, session management, and rate limiting

-- Create auth_sessions table for JWT session management
CREATE TABLE auth_sessions (
    session_id VARCHAR(32) PRIMARY KEY,
    wallet_address VARCHAR(44) NOT NULL REFERENCES users(main_wallet_pubkey) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create auth_attempts table for rate limiting
CREATE TABLE auth_attempts (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(44) NOT NULL,
    success BOOLEAN NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create audit_logs table for security monitoring
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(44),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(100),
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    success BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create api_rate_limits table for API rate limiting
CREATE TABLE api_rate_limits (
    id SERIAL PRIMARY KEY,
    identifier VARCHAR(100) NOT NULL, -- wallet address or IP
    endpoint VARCHAR(200) NOT NULL,
    request_count INTEGER DEFAULT 1,
    window_start TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create security_incidents table for flagging suspicious activity
CREATE TABLE security_incidents (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(44),
    incident_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) DEFAULT 'medium',
    description TEXT,
    metadata JSONB,
    resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by VARCHAR(44),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_auth_sessions_wallet ON auth_sessions(wallet_address);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);
CREATE INDEX idx_auth_attempts_wallet_time ON auth_attempts(wallet_address, created_at);
CREATE INDEX idx_audit_logs_wallet_time ON audit_logs(wallet_address, created_at);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_api_rate_limits_identifier ON api_rate_limits(identifier, endpoint);
CREATE INDEX idx_api_rate_limits_window ON api_rate_limits(window_start);
CREATE INDEX idx_security_incidents_wallet ON security_incidents(wallet_address);
CREATE INDEX idx_security_incidents_type ON security_incidents(incident_type);
CREATE INDEX idx_security_incidents_unresolved ON security_incidents(resolved) WHERE resolved = false;

-- Add automatic cleanup functions

-- Function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM auth_sessions 
    WHERE expires_at < CURRENT_TIMESTAMP;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old auth attempts
CREATE OR REPLACE FUNCTION cleanup_old_auth_attempts()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM auth_attempts 
    WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '7 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old rate limit records
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM api_rate_limits 
    WHERE window_start < CURRENT_TIMESTAMP - INTERVAL '1 hour';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to archive old audit logs
CREATE OR REPLACE FUNCTION archive_old_audit_logs()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- In production, you might want to move these to an archive table instead
    DELETE FROM audit_logs 
    WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '90 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to log audit events
CREATE OR REPLACE FUNCTION log_audit_event(
    p_wallet_address VARCHAR(44),
    p_action VARCHAR(100),
    p_resource_type VARCHAR(50) DEFAULT NULL,
    p_resource_id VARCHAR(100) DEFAULT NULL,
    p_details JSONB DEFAULT NULL,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_success BOOLEAN DEFAULT true
)
RETURNS UUID AS $$
DECLARE
    log_id UUID;
BEGIN
    INSERT INTO audit_logs (
        wallet_address, action, resource_type, resource_id, 
        details, ip_address, user_agent, success
    ) VALUES (
        p_wallet_address, p_action, p_resource_type, p_resource_id,
        p_details, p_ip_address, p_user_agent, p_success
    ) RETURNING id INTO log_id;
    
    RETURN log_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to check rate limits
CREATE OR REPLACE FUNCTION check_rate_limit(
    p_identifier VARCHAR(100),
    p_endpoint VARCHAR(200),
    p_max_requests INTEGER DEFAULT 100,
    p_window_minutes INTEGER DEFAULT 60
)
RETURNS BOOLEAN AS $$
DECLARE
    current_count INTEGER;
    window_start TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Calculate window start time
    window_start := CURRENT_TIMESTAMP - (p_window_minutes || ' minutes')::INTERVAL;
    
    -- Clean up old records first
    DELETE FROM api_rate_limits 
    WHERE identifier = p_identifier 
    AND endpoint = p_endpoint 
    AND window_start < window_start;
    
    -- Count current requests in window
    SELECT COALESCE(SUM(request_count), 0) INTO current_count
    FROM api_rate_limits
    WHERE identifier = p_identifier
    AND endpoint = p_endpoint
    AND window_start >= window_start;
    
    -- Check if limit exceeded
    IF current_count >= p_max_requests THEN
        RETURN false;
    END IF;
    
    -- Record this request
    INSERT INTO api_rate_limits (identifier, endpoint, request_count, window_start)
    VALUES (p_identifier, p_endpoint, 1, CURRENT_TIMESTAMP)
    ON CONFLICT (identifier, endpoint) 
    WHERE window_start >= window_start
    DO UPDATE SET 
        request_count = api_rate_limits.request_count + 1,
        created_at = CURRENT_TIMESTAMP;
    
    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Create views for security monitoring

-- View for recent security events
CREATE VIEW recent_security_events AS
SELECT 
    al.created_at,
    al.wallet_address,
    al.action,
    al.resource_type,
    al.resource_id,
    al.success,
    al.ip_address,
    CASE 
        WHEN al.action ILIKE '%failed%' THEN 'warning'
        WHEN al.action ILIKE '%delete%' THEN 'high'
        WHEN al.action ILIKE '%unauthorized%' THEN 'critical'
        ELSE 'info'
    END as severity
FROM audit_logs al
WHERE al.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
ORDER BY al.created_at DESC;

-- View for failed authentication attempts
CREATE VIEW failed_auth_attempts AS
SELECT 
    wallet_address,
    COUNT(*) as attempt_count,
    MAX(created_at) as last_attempt,
    array_agg(DISTINCT ip_address) as ip_addresses
FROM auth_attempts
WHERE success = false
AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
GROUP BY wallet_address
HAVING COUNT(*) >= 3
ORDER BY attempt_count DESC;

-- View for active sessions
CREATE VIEW active_sessions AS
SELECT 
    s.session_id,
    s.wallet_address,
    s.created_at,
    s.expires_at,
    s.last_accessed,
    EXTRACT(EPOCH FROM (s.expires_at - CURRENT_TIMESTAMP)) / 3600 as hours_until_expiry
FROM auth_sessions s
WHERE s.expires_at > CURRENT_TIMESTAMP
ORDER BY s.last_accessed DESC;

-- Add comments for documentation
COMMENT ON TABLE auth_sessions IS 'Stores JWT session data for secure authentication';
COMMENT ON TABLE auth_attempts IS 'Tracks authentication attempts for rate limiting and security monitoring';
COMMENT ON TABLE audit_logs IS 'Comprehensive audit trail for all user actions';
COMMENT ON TABLE api_rate_limits IS 'Rate limiting data for API endpoints';
COMMENT ON TABLE security_incidents IS 'Security incidents and suspicious activity tracking';

COMMENT ON FUNCTION cleanup_expired_sessions() IS 'Removes expired authentication sessions';
COMMENT ON FUNCTION cleanup_old_auth_attempts() IS 'Removes old authentication attempt records';
COMMENT ON FUNCTION check_rate_limit(VARCHAR, VARCHAR, INTEGER, INTEGER) IS 'Checks and enforces API rate limits';
COMMENT ON FUNCTION log_audit_event(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, INET, TEXT, BOOLEAN) IS 'Logs security and audit events';

-- Create triggers for automatic session cleanup
CREATE OR REPLACE FUNCTION trigger_cleanup_sessions()
RETURNS TRIGGER AS $$
BEGIN
    -- Occasionally clean up expired sessions (1% chance on each insert)
    IF random() < 0.01 THEN
        PERFORM cleanup_expired_sessions();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auth_session_cleanup
    AFTER INSERT ON auth_sessions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_cleanup_sessions();

-- Grant appropriate permissions (adjust as needed for your user)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON auth_sessions TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON auth_attempts TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON audit_logs TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON api_rate_limits TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON security_incidents TO your_app_user;