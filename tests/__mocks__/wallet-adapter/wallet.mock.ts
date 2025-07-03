import { vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';

export interface MockWalletAdapter {
  connected: boolean;
  connecting: boolean;
  disconnecting: boolean;
  publicKey: PublicKey | null;
  signTransaction: ReturnType<typeof vi.fn>;
  signAllTransactions: ReturnType<typeof vi.fn>;
  signMessage: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

export const createMockWallet = (connected = false, publicKey?: string): MockWalletAdapter => ({
  connected,
  connecting: false,
  disconnecting: false,
  publicKey: publicKey ? new PublicKey(publicKey) : null,
  signTransaction: vi.fn().mockImplementation(async (tx) => tx),
  signAllTransactions: vi.fn().mockImplementation(async (txs) => txs),
  signMessage: vi.fn().mockResolvedValue(new Uint8Array(64)),
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined)
});

// Mock for useWallet hook
export const mockUseWallet = vi.fn(() => createMockWallet(false));

// Mock connected wallet with default test address
export const mockConnectedWallet = createMockWallet(
  true, 
  '5ZoNfqXXLinvGHKj1DCd1YSVcrfEKBK8oFQ2ZJZfHk7g'
);

export default createMockWallet;
