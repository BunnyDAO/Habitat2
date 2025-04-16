import { Connection, ConnectionConfig, LogsFilter, Logs, Context, LogsCallback, Commitment } from '@solana/web3.js';

// Use the backend endpoint for RPC calls
const BACKEND_ENDPOINT = 'http://localhost:3001/api/v1';

// Rate limiting configuration
const RATE_LIMIT = {
  maxRequests: 15,
  windowMs: 1000,
  requests: 0,
  windowStart: Date.now(),
  backoffMs: 1000,
  maxBackoffMs: 10000,
  reconnectAttempts: 0,
  maxReconnectAttempts: 5
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
export function createRateLimitedConnection(endpoint: string = `${BACKEND_ENDPOINT}/rpc`, config?: ConnectionConfig): Connection {
  const connection = new Connection(endpoint, {
    commitment: 'confirmed',
    wsEndpoint: `${BACKEND_ENDPOINT}/ws`,
    ...config
  });

  // Rate limiting wrapper for onLogs
  const originalOnLogs = connection.onLogs.bind(connection);
  connection.onLogs = (filter: LogsFilter, callback: LogsCallback, commitment?: Commitment): number => {
    const wrappedCallback = async (logs: Logs, ctx: Context) => {
      if (!checkRateLimit()) {
        if (RATE_LIMIT.reconnectAttempts >= RATE_LIMIT.maxReconnectAttempts) {
          console.error('Max reconnection attempts reached');
          return 0;
        }
        
        console.log(`Rate limit exceeded, retrying after ${RATE_LIMIT.backoffMs}ms... (Attempt ${RATE_LIMIT.reconnectAttempts + 1}/${RATE_LIMIT.maxReconnectAttempts})`);
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.backoffMs));
        
        if (checkRateLimit()) {
          RATE_LIMIT.reconnectAttempts = 0;
          await callback(logs, ctx);
        } else {
          RATE_LIMIT.reconnectAttempts++;
        }
        return 0;
      }
      
      RATE_LIMIT.reconnectAttempts = 0;
      await callback(logs, ctx);
      return 0;
    };
    return originalOnLogs(filter, wrappedCallback, commitment);
  };

  return connection;
}

// Export the backend endpoint for other components to use
export const getBackendEndpoint = () => BACKEND_ENDPOINT;

const HELIUS_API_KEY = import.meta.env.VITE_HELIUS_API_KEY;
const HELIUS_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const HELIUS_WS_ENDPOINT = `wss://mainnet.helius-rpc.com/ws?api-key=${HELIUS_API_KEY}`;

const connection = new Connection(HELIUS_ENDPOINT, {
  ...(HELIUS_API_KEY ? { wsEndpoint: HELIUS_WS_ENDPOINT } : {}),
  commitment: 'confirmed'
});

const originalOnLogs = connection.onLogs.bind(connection);

connection.onLogs = (filter: LogsFilter, callback: (logs: Logs, ctx: Context) => void, commitment?: Commitment) => {
  const wrappedCallback = async (logs: Logs, ctx: Context) => {
    if (!checkRateLimit()) {
      if (RATE_LIMIT.reconnectAttempts >= RATE_LIMIT.maxReconnectAttempts) {
        console.error('Max reconnection attempts reached');
        return;
      }
      
      console.log(`Rate limit exceeded, retrying after ${RATE_LIMIT.backoffMs}ms... (Attempt ${RATE_LIMIT.reconnectAttempts + 1}/${RATE_LIMIT.maxReconnectAttempts})`);
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.backoffMs));
      
      if (checkRateLimit()) {
        RATE_LIMIT.reconnectAttempts = 0;
        callback(logs, ctx);
      } else {
        RATE_LIMIT.reconnectAttempts++;
      }
      return;
    }
    
    RATE_LIMIT.reconnectAttempts = 0;
    callback(logs, ctx);
  };
  
  return originalOnLogs(filter, wrappedCallback, commitment);
}; 