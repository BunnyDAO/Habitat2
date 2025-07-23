import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { LevelsWorker } from '../../workers/LevelsWorker';
import { LevelsStrategy, Level, JobType } from '../../types/jobs';
import { PublicKey, Keypair } from '@solana/web3.js';

// Mock fetch for Jupiter API price calls
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

// Mock Solana Connection
const mockConnection = {
  getBalance: jest.fn(),
} as any;

// Mock console to capture logs
const mockConsole = {
  log: jest.fn(),
  error: jest.fn()
};

describe('LevelsWorker - Price Level Trading Critical Tests', () => {
  let worker: LevelsWorker;
  let mockJob: LevelsStrategy;
  let mockKeypair: Keypair;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup test keypair
    mockKeypair = Keypair.generate();
    mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

    // Create base job with multiple price levels
    mockJob = {
      id: 'test-levels-job-1',
      type: JobType.LEVELS,
      tradingWalletPublicKey: mockKeypair.publicKey.toString(),
      tradingWalletSecretKey: mockKeypair.secretKey,
      levels: [
        { price: 200, percentage: 25 },  // Middle level
        { price: 150, percentage: 50 },  // Lower level
        { price: 250, percentage: 25 },  // Upper level
      ],
      isActive: true,
      lastActivity: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      lastTriggerPrice: 175, // Start between 150 and 200
      profitTracking: {
        initialBalance: 10,
        currentBalance: 10,
        totalProfit: 0,
        profitHistory: [],
        trades: []
      }
    };

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation(mockConsole.log);
    jest.spyOn(console, 'error').mockImplementation(mockConsole.error);

    // Create worker instance
    worker = new LevelsWorker(mockJob, 'https://api.mainnet-beta.solana.com');
    (worker as any).connection = mockConnection;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createJupiterPriceMock = (price: number) => ({
    ok: true,
    json: async () => ({
      data: {
        'So11111111111111111111111111111111111111112': {
          id: 'So11111111111111111111111111111111111111112',
          mintSymbol: 'SOL',
          vsToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          vsTokenSymbol: 'USDC',
          price: price
        }
      },
      timeTaken: 0.001
    })
  } as Response);

  describe('Initialization & Level Sorting - Critical Setup', () => {
    it('should sort levels by price ascending on initialization', () => {
      // Levels should be sorted: 150, 200, 250
      const sortedLevels = (worker as any).levels;
      
      expect(sortedLevels).toHaveLength(3);
      expect(sortedLevels[0].price).toBe(150);
      expect(sortedLevels[1].price).toBe(200);
      expect(sortedLevels[2].price).toBe(250);
    });

    it('should handle unsorted levels correctly', () => {
      const unsortedJob = {
        ...mockJob,
        levels: [
          { price: 300, percentage: 10 },
          { price: 100, percentage: 20 },
          { price: 200, percentage: 30 },
          { price: 50, percentage: 40 }
        ]
      };

      const unsortedWorker = new LevelsWorker(unsortedJob, 'https://api.mainnet-beta.solana.com');
      const sortedLevels = (unsortedWorker as any).levels;

      expect(sortedLevels[0].price).toBe(50);
      expect(sortedLevels[1].price).toBe(100);
      expect(sortedLevels[2].price).toBe(200);
      expect(sortedLevels[3].price).toBe(300);
    });

    it('should store trading wallet keypair correctly', () => {
      expect((worker as any).tradingWalletPublicKey).toBe(mockKeypair.publicKey.toString());
      expect((worker as any).tradingWalletSecretKey).toEqual(mockKeypair.secretKey);
      expect((worker as any).tradingWalletKeypair.publicKey.toString()).toBe(mockKeypair.publicKey.toString());
    });
  });

  describe('Price Crossing Detection - Core Business Logic', () => {
    beforeEach(() => {
      // Mock SOL balance: 10 SOL
      mockConnection.getBalance.mockResolvedValue(10 * 1e9);
    });

    it('should detect upward price crossing correctly', async () => {
      // Price moves from 175 to 210 (crosses 200 level)
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(210));

      await (worker as any).checkLevels();

      // Should detect level 200 was crossed upward
      expect(mockConsole.log).toHaveBeenCalledWith('Found 1 triggered levels at price $210');
      expect(mockConsole.log).toHaveBeenCalledWith('Selling 2.5 SOL at level 200'); // 25% of 10 SOL
    });

    it('should detect downward price crossing correctly', async () => {
      // Start at 175, price drops to 140 (crosses 150 level)
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(140));

      await (worker as any).checkLevels();

      // Should detect level 150 was crossed downward
      expect(mockConsole.log).toHaveBeenCalledWith('Found 1 triggered levels at price $140');
      expect(mockConsole.log).toHaveBeenCalledWith('Buying 5 SOL at level 150'); // 50% of 10 SOL
    });

    it('should detect multiple simultaneous level crossings', async () => {
      // Price jumps from 175 to 260 (crosses 200 and 250)
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(260));

      await (worker as any).checkLevels();

      expect(mockConsole.log).toHaveBeenCalledWith('Found 2 triggered levels at price $260');
      expect(mockConsole.log).toHaveBeenCalledWith('Selling 2.5 SOL at level 200'); // First level
      expect(mockConsole.log).toHaveBeenCalledWith('Selling 2.5 SOL at level 250'); // Second level
    });

    it('should not trigger when price stays between levels', async () => {
      // Price moves from 175 to 180 (still between 150 and 200)
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(180));

      await (worker as any).checkLevels();

      // Should not detect any triggered levels
      expect(mockConsole.log).not.toHaveBeenCalledWith(expect.stringContaining('triggered levels'));
    });
  });

  describe('Trade Amount Calculations - Financial Accuracy', () => {
    it('should calculate trade amounts based on percentage correctly', async () => {
      // Setup: 20 SOL balance, price crosses 200 level (25% allocation)
      mockConnection.getBalance.mockResolvedValue(20 * 1e9);
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(210));

      await (worker as any).checkLevels();

      // Should trade 25% of 20 SOL = 5 SOL
      expect(mockConsole.log).toHaveBeenCalledWith('Selling 5 SOL at level 200');
    });

    it('should respect minimum trade amount threshold', async () => {
      // Setup: Very small balance (0.03 SOL), level requires 25%
      mockConnection.getBalance.mockResolvedValue(0.03 * 1e9);
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(210));

      await (worker as any).checkLevels();

      // 25% of 0.03 = 0.0075 SOL (below 0.01 threshold)
      // Should detect trigger but not execute trade
      expect(mockConsole.log).toHaveBeenCalledWith('Found 1 triggered levels at price $210');
      expect(mockConsole.log).toHaveBeenCalledWith('Trade amount 0.0075 SOL below minimum threshold 0.01 SOL - skipping');
    });

    it('should handle fractional percentages correctly', async () => {
      const fractionalJob = {
        ...mockJob,
        levels: [{ price: 200, percentage: 12.5 }] // 12.5%
      };
      
      const fractionalWorker = new LevelsWorker(fractionalJob, 'https://api.mainnet-beta.solana.com');
      (fractionalWorker as any).connection = mockConnection;
      
      mockConnection.getBalance.mockResolvedValue(8 * 1e9); // 8 SOL
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(210));

      await (fractionalWorker as any).checkLevels();

      // 12.5% of 8 SOL = 1 SOL
      expect(mockConsole.log).toHaveBeenCalledWith('Selling 1 SOL at level 200');
    });
  });

  describe('Direction Determination - Buy/Sell Logic', () => {
    beforeEach(() => {
      mockConnection.getBalance.mockResolvedValue(10 * 1e9);
    });

    it('should BUY when price crosses level from above', async () => {
      // Price drops from 175 to 140 (crosses 150 from above)
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(140));

      await (worker as any).checkLevels();

      expect(mockConsole.log).toHaveBeenCalledWith('Buying 5 SOL at level 150');
    });

    it('should SELL when price crosses level from below', async () => {
      // Price rises from 175 to 210 (crosses 200 from below)
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(210));

      await (worker as any).checkLevels();

      expect(mockConsole.log).toHaveBeenCalledWith('Selling 2.5 SOL at level 200');
    });

    it('should handle exact price matches correctly', async () => {
      // Price lands exactly on level 200
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(200));

      await (worker as any).checkLevels();

      // Should trigger when price equals level (from below in this case)
      expect(mockConsole.log).toHaveBeenCalledWith('Found 1 triggered levels at price $200');
    });
  });

  describe('Financial Safety Validations - Risk Management', () => {
    it('should filter out negative price levels', () => {
      const invalidJob = {
        ...mockJob,
        levels: [
          { price: -50, percentage: 25 },
          { price: 100, percentage: 25 }
        ]
      };

      // Should filter out negative prices during validation
      const invalidWorker = new LevelsWorker(invalidJob, 'https://api.mainnet-beta.solana.com');
      const levels = (invalidWorker as any).levels;
      
      // Negative price should be filtered out, only valid price remains
      expect(levels).toHaveLength(1);
      expect(levels[0].price).toBe(100);
      expect(levels[0].percentage).toBe(25);
    });

    it('should filter out invalid percentage allocations', async () => {
      const invalidPercentageJob = {
        ...mockJob,
        levels: [
          { price: 100, percentage: -10 }, // Negative percentage
          { price: 200, percentage: 150 }, // Over 100%
          { price: 300, percentage: 50 }   // Valid
        ]
      };

      const invalidWorker = new LevelsWorker(invalidPercentageJob, 'https://api.mainnet-beta.solana.com');
      const levels = (invalidWorker as any).levels;
      
      // Only valid level should remain
      expect(levels).toHaveLength(1);
      expect(levels[0].price).toBe(300);
      expect(levels[0].percentage).toBe(50);
    });

    it('should handle zero balance gracefully', async () => {
      mockConnection.getBalance.mockResolvedValue(0); // No balance
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(210));

      await (worker as any).checkLevels();

      // Should detect trigger but not attempt trade with 0 balance
      expect(mockConsole.log).toHaveBeenCalledWith('Found 1 triggered levels at price $210');
      expect(mockConsole.log).toHaveBeenCalledWith('Trade amount 0 SOL below minimum threshold 0.01 SOL - skipping');
    });
  });

  describe('State Management - Preventing Duplicate Triggers', () => {
    it('should update lastTriggerPrice after processing levels', async () => {
      mockConnection.getBalance.mockResolvedValue(10 * 1e9);
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(210));

      const initialLastPrice = mockJob.lastTriggerPrice;
      
      await (worker as any).checkLevels();

      // Should update last trigger price
      expect(mockJob.lastTriggerPrice).toBe(210);
      expect(mockJob.lastTriggerPrice).not.toBe(initialLastPrice);
    });

    it('should update lastActivity timestamp when levels trigger', async () => {
      mockConnection.getBalance.mockResolvedValue(10 * 1e9);
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(210));

      const initialActivity = mockJob.lastActivity;
      
      await (worker as any).checkLevels();

      // Activity should be updated
      expect(mockJob.lastActivity).not.toBe(initialActivity);
    });

    it('should not trigger same level twice without price returning', async () => {
      mockConnection.getBalance.mockResolvedValue(10 * 1e9);
      
      // First check: price at 210 (crosses 200)
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(210));
      
      await (worker as any).checkLevels();
      expect(mockConsole.log).toHaveBeenCalledWith('Found 1 triggered levels at price $210');
      
      // Clear mocks
      mockConsole.log.mockClear();
      
      // Second check: price still at 210 (should not trigger again)
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(210));
      
      await (worker as any).checkLevels();
      expect(mockConsole.log).not.toHaveBeenCalledWith(expect.stringContaining('triggered levels'));
    });
  });

  describe('Error Handling & Edge Cases - Robustness', () => {
    it('should handle price API failures gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect((worker as any).checkLevels()).rejects.toThrow('Network error');
      
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Error checking levels:',
        expect.any(Error)
      );
    });

    it('should handle malformed price data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ /* Missing data structure */ })
      } as Response);

      await expect((worker as any).checkLevels()).rejects.toThrow('Invalid price data received from Jupiter API');
    });

    it('should handle connection failures when checking balance', async () => {
      mockConnection.getBalance.mockRejectedValueOnce(new Error('Connection failed'));
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(210));

      await expect((worker as any).checkLevels()).rejects.toThrow('Connection failed');
    });

    it('should handle empty levels array', async () => {
      const emptyJob = { ...mockJob, levels: [] };
      const emptyWorker = new LevelsWorker(emptyJob, 'https://api.mainnet-beta.solana.com');
      (emptyWorker as any).connection = mockConnection;
      
      mockConnection.getBalance.mockResolvedValue(10 * 1e9);
      mockFetch.mockResolvedValueOnce(createJupiterPriceMock(210));

      await (emptyWorker as any).checkLevels();

      // Should complete without errors
      expect(mockConsole.log).not.toHaveBeenCalledWith(expect.stringContaining('triggered levels'));
    });
  });

  describe('Worker Lifecycle Management', () => {
    it('should start and stop correctly', async () => {
      jest.spyOn(worker as any, 'monitorLevels').mockResolvedValue(undefined);

      await worker.start();
      expect((worker as any).isRunning).toBe(true);
      
      await worker.stop();
      expect((worker as any).isRunning).toBe(false);
    });

    it('should prevent multiple starts', async () => {
      jest.spyOn(worker as any, 'monitorLevels').mockResolvedValue(undefined);
      
      await worker.start();
      await worker.start(); // Second start should be ignored
      
      expect((worker as any).isRunning).toBe(true);
      expect((worker as any).monitorLevels).toHaveBeenCalledTimes(1);
    });

    it('should handle errors during start', async () => {
      jest.spyOn(worker as any, 'monitorLevels').mockRejectedValue(new Error('Start failed'));
      
      await expect(worker.start()).rejects.toThrow('Start failed');
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Error starting levels monitor:',
        expect.any(Error)
      );
    });
  });
});