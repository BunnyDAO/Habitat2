-- Fix for the ambiguous column reference in check_rate_limit function
-- This replaces the existing function with proper column qualification and logic

CREATE OR REPLACE FUNCTION check_rate_limit(
    p_identifier VARCHAR(100),
    p_endpoint VARCHAR(200),
    p_max_requests INTEGER DEFAULT 100,
    p_window_minutes INTEGER DEFAULT 60
)
RETURNS BOOLEAN AS $$
DECLARE
    current_count INTEGER;
    window_start_time TIMESTAMP WITH TIME ZONE;  -- Renamed variable to avoid ambiguity
BEGIN
    -- Calculate window start time
    window_start_time := CURRENT_TIMESTAMP - (p_window_minutes || ' minutes')::INTERVAL;
    
    -- Clean up old records first
    DELETE FROM api_rate_limits 
    WHERE identifier = p_identifier 
    AND endpoint = p_endpoint 
    AND api_rate_limits.window_start < window_start_time;  -- Qualified column reference
    
    -- Count current requests in window
    SELECT COALESCE(SUM(request_count), 0) INTO current_count
    FROM api_rate_limits
    WHERE identifier = p_identifier
    AND endpoint = p_endpoint
    AND api_rate_limits.window_start >= window_start_time;  -- Qualified column reference
    
    -- Check if limit exceeded
    IF current_count >= p_max_requests THEN
        RETURN false;
    END IF;
    
    -- Record this request (simple insert, no conflict resolution needed)
    INSERT INTO api_rate_limits (identifier, endpoint, request_count, window_start, created_at)
    VALUES (p_identifier, p_endpoint, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    
    RETURN true;
END;
$$ LANGUAGE plpgsql;