import { vi } from 'vitest';
import type { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

export interface MockSolanaConnection extends Partial<Connection> {
  getBalance: ReturnType<typeof vi.fn>;
  getParsedTokenAccountsByOwner: ReturnType<typeof vi.fn>;
  sendTransaction: ReturnType<typeof vi.fn>;
  confirmTransaction: ReturnType<typeof vi.fn>;
  getAccountInfo: ReturnType<typeof vi.fn>;
  getLatestBlockhash: ReturnType<typeof vi.fn>;
  simulateTransaction: ReturnType<typeof vi.fn>;
}

export const createMockConnection = (): MockSolanaConnection => ({
  getBalance: vi.fn().mockResolvedValue(1000000000), // 1 SOL in lamports
  getParsedTokenAccountsByOwner: vi.fn().mockResolvedValue({ value: [] }),
  sendTransaction: vi.fn().mockResolvedValue('mock-transaction-signature'),
  confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
  getAccountInfo: vi.fn().mockResolvedValue(null),
  getLatestBlockhash: vi.fn().mockResolvedValue({
    blockhash: 'mock-blockhash',
    lastValidBlockHeight: 123456789
  }),
  simulateTransaction: vi.fn().mockResolvedValue({
    value: { err: null, logs: [] }
  })
});

// Default mock for automatic imports
export default createMockConnection();
