import { jest } from '@jest/globals';
import axios from 'axios';

// Mock Jupiter API responses
export const mockJupiterQuoteResponse = {
  data: {
    inputMint: 'So11111111111111111111111111111111111111112', // SOL
    inAmount: '1000000000', // 1 SOL
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    outAmount: '159000000', // ~$159 USDC
    otherAmountThreshold: '158000000',
    swapMode: 'ExactIn',
    slippageBps: 50,
    platformFee: null,
    priceImpactPct: '0.01',
    routePlan: [
      {
        swapInfo: {
          ammKey: 'mock-amm-key',
          label: 'Raydium',
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          inAmount: '1000000000',
          outAmount: '159000000',
          feeAmount: '2500000',
          feeMint: 'So11111111111111111111111111111111111111112'
        },
        percent: 100
      }
    ],
    contextSlot: 123456789,
    timeTaken: 0.05
  }
};

export const mockJupiterSwapResponse = {
  data: {
    swapTransaction: 'mock-serialized-transaction-base64',
    lastValidBlockHeight: 1000000
  }
};

export const mockJupiterPriceResponse = {
  data: {
    'So11111111111111111111111111111111111111112': {
      id: 'So11111111111111111111111111111111111111112',
      mintSymbol: 'SOL',
      vsToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      vsTokenSymbol: 'USDC',
      price: 159.25
    }
  }
};

// Mock Jupiter API class
export class MockJupiterAPI {
  private static instance: MockJupiterAPI;
  
  static getInstance(): MockJupiterAPI {
    if (!MockJupiterAPI.instance) {
      MockJupiterAPI.instance = new MockJupiterAPI();
    }
    return MockJupiterAPI.instance;
  }

  // Mock quote endpoint
  getQuote = jest.fn().mockResolvedValue(mockJupiterQuoteResponse);
  
  // Mock swap endpoint
  getSwapTransaction = jest.fn().mockResolvedValue(mockJupiterSwapResponse);
  
  // Mock price endpoint
  getPrice = jest.fn().mockResolvedValue(mockJupiterPriceResponse);
  
  // Mock error scenarios
  simulateQuoteError = () => {
    this.getQuote.mockRejectedValueOnce(new Error('Jupiter API quote failed'));
  };
  
  simulateSwapError = () => {
    this.getSwapTransaction.mockRejectedValueOnce(new Error('Jupiter API swap failed'));
  };
  
  simulatePriceError = () => {
    this.getPrice.mockRejectedValueOnce(new Error('Jupiter API price failed'));
  };
  
  // Simulate rate limiting
  simulateRateLimit = () => {
    const rateLimitError = new Error('Rate limit exceeded');
    (rateLimitError as any).response = { status: 429 };
    this.getQuote.mockRejectedValueOnce(rateLimitError);
    this.getSwapTransaction.mockRejectedValueOnce(rateLimitError);
    this.getPrice.mockRejectedValueOnce(rateLimitError);
  };

  // Reset all mocks
  reset = () => {
    this.getQuote.mockReset().mockResolvedValue(mockJupiterQuoteResponse);
    this.getSwapTransaction.mockReset().mockResolvedValue(mockJupiterSwapResponse);
    this.getPrice.mockReset().mockResolvedValue(mockJupiterPriceResponse);
  };
}

// Mock axios for Jupiter API calls
export const mockJupiterAxios = () => {
  const mockAxios = axios as any;
  
  mockAxios.get = jest.fn().mockImplementation((url: string) => {
    if (url.includes('/quote')) {
      return Promise.resolve(mockJupiterQuoteResponse);
    }
    if (url.includes('/price')) {
      return Promise.resolve(mockJupiterPriceResponse);
    }
    return Promise.reject(new Error('Unknown Jupiter endpoint'));
  });
  
  mockAxios.post = jest.fn().mockImplementation((url: string) => {
    if (url.includes('/swap')) {
      return Promise.resolve(mockJupiterSwapResponse);
    }
    return Promise.reject(new Error('Unknown Jupiter endpoint'));
  });
  
  return mockAxios;
};

// Export mock factory
export const createMockJupiterAPI = (): MockJupiterAPI => {
  return MockJupiterAPI.getInstance();
};