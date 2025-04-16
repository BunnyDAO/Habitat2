import { Connection, ConnectionConfig, PublicKey, AccountChangeCallback, ProgramAccountChangeCallback, Commitment } from '@solana/web3.js';

const HELIUS_ENDPOINT = '/api/rpc';
const WS_ENDPOINT = 'ws://localhost:3001/api/v1/ws';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

let connection: Connection | null = null;
let isConnecting = false;
const subscriptionRetries = new Map<string, number>();

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retrySubscription(subscriptionId: string, operation: () => number): Promise<number> {
  let retries = subscriptionRetries.get(subscriptionId) || 0;
  
  while (retries < MAX_RETRIES) {
    try {
      const subId = operation();
      subscriptionRetries.delete(subscriptionId);
      return subId;
    } catch (error) {
      console.warn(`Subscription attempt ${retries + 1} failed:`, error);
      retries++;
      subscriptionRetries.set(subscriptionId, retries);
      await sleep(RETRY_DELAY * Math.pow(2, retries));
    }
  }
  
  throw new Error(`Failed to establish subscription after ${MAX_RETRIES} attempts`);
}

export function createConnection(config?: ConnectionConfig): Connection {
  if (connection && !isConnecting) {
    return connection;
  }

  isConnecting = true;
  
  const newConnection = new Connection(HELIUS_ENDPOINT, {
    wsEndpoint: WS_ENDPOINT,
    commitment: 'confirmed',
    ...config
  });

  // Create a proxy for the connection to handle subscription retries
  const connectionProxy = new Proxy(newConnection, {
    get(target, prop) {
      if (prop === 'onProgramAccountChange') {
        return (
          programId: PublicKey,
          callback: ProgramAccountChangeCallback,
          commitment?: Commitment
        ) => {
          const subscriptionId = `program-${programId.toBase58()}`;
          const subId = retrySubscription(subscriptionId, () => 
            target.onProgramAccountChange(programId, callback, commitment)
          );
          return subId;
        };
      }
      if (prop === 'onAccountChange') {
        return (
          publicKey: PublicKey,
          callback: AccountChangeCallback,
          commitment?: Commitment
        ) => {
          const subscriptionId = `account-${publicKey.toBase58()}`;
          const subId = retrySubscription(subscriptionId, () => 
            target.onAccountChange(publicKey, callback, commitment)
          );
          return subId;
        };
      }
      return target[prop as keyof Connection];
    }
  });

  connection = connectionProxy;
  isConnecting = false;
  return connectionProxy;
}

export const defaultConnection = createConnection(); 