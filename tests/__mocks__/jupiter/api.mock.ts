import { vi } from 'vitest';

export interface MockJupiterAPI {
  getQuote: ReturnType<typeof vi.fn>;
  getSwapTransaction: ReturnType<typeof vi.fn>;
  init: ReturnType<typeof vi.fn>;
  openModal: ReturnType<typeof vi.fn>;
}

export const createMockJupiterAPI = (): MockJupiterAPI => ({
  getQuote: vi.fn().mockResolvedValue({
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    inAmount: '1000000000',
    outAmount: '100000000',
    otherAmountThreshold: '99000000',
    swapMode: 'ExactIn',
    slippageBps: 100,
    platformFee: null,
    priceImpactPct: '0.01',
    routePlan: []
  }),
  getSwapTransaction: vi.fn().mockResolvedValue({
    swapTransaction: 'mock-swap-transaction-base64',
    lastValidBlockHeight: 123456789
  }),
  init: vi.fn().mockResolvedValue(undefined),
  openModal: vi.fn().mockResolvedValue(undefined)
});

// Mock Jupiter token list
export const mockJupiterTokens = [
  {
    address: 'So11111111111111111111111111111111111111112',
    chainId: 101,
    decimals: 9,
    name: 'Wrapped SOL',
    symbol: 'SOL',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'
  },
  {
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    chainId: 101,
    decimals: 6,
    name: 'USD Coin',
    symbol: 'USDC',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png'
  }
];

export default createMockJupiterAPI();
