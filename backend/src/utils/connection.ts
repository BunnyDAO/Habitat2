import { Connection } from '@solana/web3.js';

export function createRateLimitedConnection(endpoint: string): Connection {
  return new Connection(endpoint);
} 