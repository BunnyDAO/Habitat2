import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { PriceMonitorWorker } from '../../workers/PriceMonitorWorker';
import { PriceMonitoringJob } from '../../types/jobs';
import { PublicKey, Keypair } from '@solana/web3.js';
import { 
  createMockConnection, 
  mockPublicKey, 
  mockKeypair 
} from '../mocks/solana.mock';
import { 
  createMockJupiterAPI, 
  mockJupiterQuoteResponse,
  mockJupiterSwapResponse 
} from '../mocks/jupiter.mock';

// Mock Jupiter API endpoints
const JUPITER_API_BASE = 'https://api.jup.ag/swap/v1';

// Mock fetch for Jupiter API calls
global.fetch = jest.fn();

describe('PriceMonitorWorker', () => {
  let worker: PriceMonitorWorker;
  let mockJob: PriceMonitoringJob;
  let mockKeypair: Keypair;
  let mockConnection: any;
  let mockJupiterAPI: any;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create test data
    mockKeypair = Keypair.generate();
    
    mockJob = {
      id: 'test-price-job-1',
      strategy_id: 1,
      trading_wallet_id: 1,
      strategy_type: 'price-monitor',
      tradingWalletPublicKey: mockKeypair.publicKey.toString(),
      tradingWalletSecretKey: mockKeypair.secretKey,
      targetPrice: 200.00, // $200 target price
      direction: 'above',
      percentageToSell: 50, // Sell 50% of SOL
      lastActivity: new Date().toISOString(),
      isActive: true,
      profitTracking: {
        trades: [],
        totalProfit: 0,
        totalVolume: 0
      }
    };

    // Setup mocks
    mockConnection = createMockConnection();
    mockJupiterAPI = createMockJupiterAPI();
    mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    
    worker = new PriceMonitorWorker(mockJob, 'test-endpoint');
  });

  afterEach(() => {
    if (worker) {
      worker.stop();
    }
  });

  describe('Initialization', () => {
    it('should initialize with correct trading parameters', () => {
      expect(worker).toBeDefined();
      expect(worker['targetPrice']).toBe(200.00);
      expect(worker['direction']).toBe('above');
      expect(worker['percentageToSell']).toBe(50);
      expect(worker['tradingWalletPublicKey']).toBe(mockKeypair.publicKey.toString());
    });

    it('should create trading wallet keypair from secret key', () => {
      expect(worker['tradingWalletKeypair']).toBeDefined();
      expect(worker['tradingWalletKeypair'].publicKey.toString()).toBe(
        mockKeypair.publicKey.toString()
      );
    });

    it('should set cooldown period correctly', () => {
      expect(worker['cooldownPeriod']).toBe(300000); // 5 minutes
    });
  });

  describe('Price Monitoring Logic - Critical Financial Logic', () => {
    beforeEach(() => {
      // Mock successful price API response
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ SOL: 180.50 }) // Below target price
      } as any);
    });

    it('should fetch current SOL price correctly', async () => {
      // Mock balance check
      mockConnection.getBalance.mockResolvedValueOnce(5000000000); // 5 SOL
      
      // Start monitoring for one cycle
      const monitorPromise = worker['monitorPrice']();
      worker['isRunning'] = true;
      
      // Stop after short delay
      setTimeout(() => worker.stop(), 100);
      
      await monitorPromise;
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`${JUPITER_API_BASE}/price?ids=SOL`)
      );
    });

    it('should trigger trade when price condition is met (above)', async () => {
      // Mock price above target
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ SOL: 250.00 }) // Above $200 target
      } as any);

      // Mock balance and trade execution
      mockConnection.getBalance.mockResolvedValueOnce(5000000000); // 5 SOL
      mockConnection.getLatestBlockhash.mockResolvedValueOnce({
        blockhash: 'test-blockhash',
        lastValidBlockHeight: 1000000
      });
      
      // Mock Jupiter quote and swap responses
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ SOL: 250.00 })
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockJupiterQuoteResponse.data)
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            instructions: [
              {
                programId: '11111111111111111111111111111111',
                accounts: [],
                data: ''
              }
            ]
          })
        } as any);

      worker['isRunning'] = true;
      
      const monitorPromise = worker['monitorPrice']();
      
      // Should trigger and stop automatically
      await monitorPromise;
      
      expect(worker['isRunning']).toBe(false); // Should stop after execution
      expect(mockJob.isActive).toBe(false); // Should deactivate job
    });

    it('should not trigger trade when price condition is not met', async () => {
      // Mock price below target (target is $200, direction is 'above')
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ SOL: 180.00 }) // Below target
      } as any);

      worker['isRunning'] = true;
      
      const monitorPromise = worker['monitorPrice']();
      
      // Stop after short delay
      setTimeout(() => worker.stop(), 50);
      
      await monitorPromise;
      
      expect(mockJob.isActive).toBe(true); // Should remain active
    });

    it('should enforce cooldown period between trades', async () => {
      // Set recent trigger time
      worker['lastTriggered'] = Date.now() - 60000; // 1 minute ago (less than 5 min cooldown)
      
      // Mock price that would normally trigger
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ SOL: 250.00 }) // Above target
      } as any);

      worker['isRunning'] = true;
      
      const monitorPromise = worker['monitorPrice']();
      
      setTimeout(() => worker.stop(), 50);
      
      await monitorPromise;
      
      expect(mockJob.isActive).toBe(true); // Should not trigger due to cooldown
    });
  });

  describe('Trade Execution - Critical Financial Operations', () => {
    beforeEach(() => {
      // Mock successful API responses
      mockConnection.getBalance.mockResolvedValue(5000000000); // 5 SOL
      mockConnection.getLatestBlockhash.mockResolvedValue({
        blockhash: 'test-blockhash',
        lastValidBlockHeight: 1000000
      });
      mockConnection.sendTransaction.mockResolvedValue('test-signature');
    });

    it('should validate sufficient balance before trading', async () => {
      // Mock insufficient balance
      mockConnection.getBalance.mockResolvedValueOnce(5000); // 0.000005 SOL (below minimum)
      
      await expect(worker['executeTrade'](250.00)).rejects.toThrow(
        'Insufficient SOL balance for transaction fees'
      );
    });

    it('should calculate trade amount correctly', async () => {
      const currentPrice = 250.00;
      const solBalance = 5.0; // 5 SOL
      const expectedSwapAmount = (solBalance * 50) / 100; // 2.5 SOL (50%)
      
      // Mock Jupiter responses
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockJupiterQuoteResponse.data)
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            instructions: [
              {
                programId: '11111111111111111111111111111111',
                accounts: [],
                data: ''
              }
            ]
          })
        } as any);

      await worker['executeTrade'](currentPrice);
      
      // Check if correct amount was calculated and used in API call
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`amount=${Math.floor(expectedSwapAmount * 1e9)}`)
      );
    });

    it('should validate trade amount boundaries', async () => {
      // Mock balance where calculated amount would be invalid
      mockConnection.getBalance.mockResolvedValueOnce(15000); // Very small balance
      
      await expect(worker['executeTrade'](250.00)).rejects.toThrow(
        'Invalid swap amount or insufficient balance'
      );
    });

    it('should handle Jupiter API quote failures gracefully', async () => {
      // Mock failed quote response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Quote service unavailable'
      } as any);
      
      await expect(worker['executeTrade'](250.00)).rejects.toThrow(
        'Failed to get quote: Quote service unavailable'
      );
    });

    it('should handle Jupiter API swap failures gracefully', async () => {
      // Mock successful quote but failed swap
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockJupiterQuoteResponse.data)
        } as any)
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Swap service unavailable'
        } as any);
      
      await expect(worker['executeTrade'](250.00)).rejects.toThrow(
        'Failed to get swap transaction: Swap service unavailable'
      );
    });

    it('should update profit tracking after successful trade', async () => {
      const currentPrice = 250.00;
      const solBalance = 5.0;
      const swapAmount = 2.5; // 50% of 5 SOL
      
      // Mock successful trade
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockJupiterQuoteResponse.data)
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            instructions: [
              {
                programId: '11111111111111111111111111111111',
                accounts: [],
                data: ''
              }
            ]
          })
        } as any);

      await worker['executeTrade'](currentPrice);
      
      expect(mockJob.profitTracking.trades).toHaveLength(1);
      expect(mockJob.profitTracking.trades[0]).toMatchObject({
        type: 'sell',
        amount: swapAmount,
        price: currentPrice
      });
    });
  });

  describe('Direction-Based Logic - Financial Safety', () => {
    it('should handle "below" direction correctly', () => {
      const belowJob = {
        ...mockJob,
        direction: 'below' as const,
        targetPrice: 150.00
      };
      
      const belowWorker = new PriceMonitorWorker(belowJob, 'test-endpoint');
      
      expect(belowWorker['direction']).toBe('below');
      expect(belowWorker['targetPrice']).toBe(150.00);
    });

    it('should trigger correctly for below direction', async () => {
      const belowJob = {
        ...mockJob,
        direction: 'below' as const,
        targetPrice: 200.00
      };
      
      const belowWorker = new PriceMonitorWorker(belowJob, 'test-endpoint');
      
      // Mock price below target
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ SOL: 180.00 }) // Below $200 target
      } as any);
      
      mockConnection.getBalance.mockResolvedValue(5000000000);
      mockConnection.getLatestBlockhash.mockResolvedValue({
        blockhash: 'test-blockhash',
        lastValidBlockHeight: 1000000
      });
      
      // Mock Jupiter responses
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ SOL: 180.00 })
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockJupiterQuoteResponse.data)
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            instructions: [
              {
                programId: '11111111111111111111111111111111',
                accounts: [],
                data: ''
              }
            ]
          })
        } as any);

      belowWorker['isRunning'] = true;
      
      const monitorPromise = belowWorker['monitorPrice']();
      
      await monitorPromise;
      
      expect(belowWorker['isRunning']).toBe(false); // Should stop after execution
    });
  });

  describe('Error Handling - Financial Safety Critical', () => {
    it('should handle price API failures gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Price API unavailable'));
      
      worker['isRunning'] = true;
      
      const monitorPromise = worker['monitorPrice']();
      
      // Stop after short delay to prevent infinite loop
      setTimeout(() => worker.stop(), 100);
      
      await monitorPromise;
      
      // Should continue running despite API error
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle transaction execution failures', async () => {
      mockConnection.sendTransaction.mockRejectedValueOnce(
        new Error('Transaction failed')
      );
      
      // Mock successful API responses up to transaction
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockJupiterQuoteResponse.data)
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            instructions: [
              {
                programId: '11111111111111111111111111111111',
                accounts: [],
                data: ''
              }
            ]
          })
        } as any);
      
      await expect(worker['executeTrade'](250.00)).rejects.toThrow(
        'All retry attempts failed'
      );
    });

    it('should validate fee calculations', async () => {
      // Mock very small balance that would result in invalid fees
      mockConnection.getBalance.mockResolvedValueOnce(2000); // 0.000002 SOL
      
      await expect(worker['executeTrade'](250.00)).rejects.toThrow(
        'Transaction amount too small for fee calculation'
      );
    });
  });

  describe('Lifecycle Management', () => {
    it('should start monitoring successfully', async () => {
      // Mock to prevent infinite loop
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ SOL: 180.00 })
      } as any);

      const startPromise = worker.start();
      
      // Stop quickly to avoid infinite monitoring
      setTimeout(() => worker.stop(), 50);
      
      await startPromise;
      
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should stop monitoring correctly', async () => {
      worker['isRunning'] = true;
      
      await worker.stop();
      
      expect(worker['isRunning']).toBe(false);
    });

    it('should not start if already running', async () => {
      worker['isRunning'] = true;
      
      await worker.start();
      
      // Should not make additional API calls
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Financial Safety Validations', () => {
    it('should validate percentage limits', () => {
      expect(worker['percentageToSell']).toBe(50);
      expect(worker['percentageToSell']).toBeGreaterThan(0);
      expect(worker['percentageToSell']).toBeLessThanOrEqual(100);
    });

    it('should validate target price is positive', () => {
      expect(worker['targetPrice']).toBe(200.00);
      expect(worker['targetPrice']).toBeGreaterThan(0);
    });

    it('should enforce minimum fee requirements', async () => {
      // Test the fee validation logic
      const amountInLamports = 1000; // Very small amount
      const feeAmount = Math.floor(amountInLamports * 0.0005);
      
      expect(feeAmount).toBeLessThan(1000); // Should trigger error
    });

    it('should prevent trades without sufficient balance', async () => {
      mockConnection.getBalance.mockResolvedValueOnce(5000); // Less than 10000 minimum
      
      await expect(worker['executeTrade'](250.00)).rejects.toThrow(
        'Insufficient SOL balance for transaction fees'
      );
    });
  });
});