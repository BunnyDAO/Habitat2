import { Connection, ConnectionConfig, Commitment, LogsFilter, Logs, Context } from '@solana/web3.js';

const HELIUS_ENDPOINT = 'https://mainnet.helius-rpc.com/?api-key=dd2b28a0-d00e-44f1-bbda-23c042d7476a';
const HELIUS_WS_ENDPOINT = 'wss://mainnet.helius-rpc.com/ws?api-key=dd2b28a0-d00e-44f1-bbda-23c042d7476a';

// Rate limiting configuration
const RATE_LIMIT = {
  maxRequests: 15,
  windowMs: 1000,
  requests: 0,
  windowStart: Date.now(),
  backoffMs: 1000,
  maxBackoffMs: 10000
};

// Enhanced rate limit check with exponential backoff
const checkRateLimit = () => {
  const now = Date.now();
  if (now - RATE_LIMIT.windowStart > RATE_LIMIT.windowMs) {
    RATE_LIMIT.requests = 0;
    RATE_LIMIT.windowStart = now;
    RATE_LIMIT.backoffMs = 1000;
    return true;
  }
  
  if (RATE_LIMIT.requests >= RATE_LIMIT.maxRequests) {
    RATE_LIMIT.backoffMs = Math.min(RATE_LIMIT.backoffMs * 2, RATE_LIMIT.maxBackoffMs);
    return false;
  }
  
  RATE_LIMIT.requests++;
  return true;
};

// Create a rate-limited connection
export const createRateLimitedConnection = (endpoint: string = HELIUS_ENDPOINT, config?: ConnectionConfig) => {
  const connection = new Connection(endpoint, {
    ...config,
    wsEndpoint: HELIUS_WS_ENDPOINT
  });
  
  const originalOnLogs = connection.onLogs.bind(connection);
  
  connection.onLogs = (filter: LogsFilter, callback: (logs: Logs, ctx: Context) => void, commitment?: Commitment) => {
    const wrappedCallback = async (logs: Logs, ctx: Context) => {
      if (!checkRateLimit()) {
        console.log(`Rate limit exceeded, retrying after ${RATE_LIMIT.backoffMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.backoffMs));
        if (checkRateLimit()) {
          callback(logs, ctx);
        }
        return;
      }
      callback(logs, ctx);
    };
    
    return originalOnLogs(filter, wrappedCallback, commitment);
  };
  
  return connection;
}; 