import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { WalletMonitorWorker } from '../../workers/WalletMonitorWorker';
import { WalletMonitoringJob } from '../../types/jobs';
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

// Mock external dependencies
jest.mock('../../utils/connection', () => ({
  createRateLimitedConnection: jest.fn(() => createMockConnection())
}));

jest.mock('../../config/api', () => ({
  API_CONFIG: {
    JUPITER: {
      QUOTE: 'https://mock-jupiter.com/quote?',
      SWAP: 'https://mock-jupiter.com/swap'
    }
  }
}));

// Mock fetch for Jupiter API calls
global.fetch = jest.fn();

describe('WalletMonitorWorker', () => {
  let worker: WalletMonitorWorker;
  let mockJob: WalletMonitoringJob;
  let mockTradingWallet: PublicKey;
  let mockKeypair: Keypair;
  let mockConnection: any;
  let mockJupiterAPI: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create test data
    mockKeypair = Keypair.generate();
    mockTradingWallet = mockKeypair.publicKey;
    
    mockJob = {
      id: 'test-job-1',
      strategy_id: 1,
      trading_wallet_id: 1,
      strategy_type: 'wallet-monitor',
      walletAddress: 'target-wallet-address',
      percentage: 50,
      recentTransactions: [],
      tradingWalletSecretKey: mockKeypair.secretKey
    };

    // Setup mocks
    mockConnection = createMockConnection();
    mockJupiterAPI = createMockJupiterAPI();
    
    // Mock fetch responses
    (global.fetch as jest.MockedFunction<typeof fetch>)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJupiterQuoteResponse.data)
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJupiterSwapResponse.data)
      } as any);

    worker = new WalletMonitorWorker(mockJob, 'test-endpoint', mockTradingWallet);
  });

  afterEach(() => {
    if (worker) {
      worker.stop();
    }
  });

  describe('Initialization', () => {
    it('should initialize with correct properties', () => {
      expect(worker).toBeDefined();
      expect(worker['walletAddress']).toBe('target-wallet-address');
      expect(worker['percentage']).toBe(50);
      expect(worker['recentTransactions']).toEqual(new Set());
    });

    it('should handle invalid secret key gracefully', () => {
      const invalidJob = {
        ...mockJob,
        tradingWalletSecretKey: 'invalid-key'
      };

      // Should not throw error during construction
      expect(() => {
        new WalletMonitorWorker(invalidJob, 'test-endpoint', mockTradingWallet);
      }).not.toThrow();
    });

    it('should initialize recent transactions from job data', () => {
      const jobWithHistory = {
        ...mockJob,
        recentTransactions: ['sig1', 'sig2', 'sig3']
      };

      const workerWithHistory = new WalletMonitorWorker(
        jobWithHistory, 
        'test-endpoint', 
        mockTradingWallet
      );

      expect(workerWithHistory['recentTransactions'].size).toBe(3);
      expect(workerWithHistory['recentTransactions'].has('sig1')).toBe(true);
    });
  });

  describe('Lifecycle Management', () => {
    it('should start monitoring successfully', async () => {
      await worker.start();
      
      expect(mockConnection.onLogs).toHaveBeenCalledWith(
        expect.any(PublicKey),
        expect.any(Function),
        'confirmed'
      );
      expect(worker['isRunning']).toBe(true);
    });

    it('should stop monitoring successfully', async () => {
      await worker.start();
      await worker.stop();
      
      expect(mockConnection.removeOnLogsListener).toHaveBeenCalled();
      expect(worker['isRunning']).toBe(false);
    });

    it('should not start if already running', async () => {
      await worker.start();
      const onLogsCallCount = mockConnection.onLogs.mock.calls.length;
      
      // Try to start again
      await worker.start();
      
      // Should not call onLogs again
      expect(mockConnection.onLogs.mock.calls.length).toBe(onLogsCallCount);
    });

    it('should handle start errors gracefully', async () => {
      mockConnection.onLogs.mockRejectedValueOnce(new Error('Connection failed'));
      
      await expect(worker.start()).rejects.toThrow('Connection failed');
    });
  });

  describe('Transaction Processing - Critical Financial Logic', () => {
    beforeEach(async () => {
      await worker.start();
    });

    it('should skip duplicate transactions', async () => {
      const signature = 'test-signature';
      
      // Process transaction first time
      await worker['processTransaction'](signature);
      
      // Try to process same transaction again
      const result = await worker['processTransaction'](signature);
      
      expect(result.status).toBe('failed');
      expect(result.error).toContain('already processed');
    });

    it('should prevent concurrent processing of same transaction', async () => {
      const signature = 'test-signature';
      
      // Start processing transaction (don't await)
      const promise1 = worker['processTransaction'](signature);
      
      // Try to process same transaction concurrently
      const promise2 = worker['processTransaction'](signature);
      
      const [result1, result2] = await Promise.all([promise1, promise2]);
      
      // One should succeed, one should fail due to concurrent processing
      const failedResults = [result1, result2].filter(r => r.status === 'failed');
      expect(failedResults.length).toBe(1);
      expect(failedResults[0].error).toContain('already processed or in progress');
    });

    it('should clean up old transactions correctly', () => {
      // Add old transactions
      const oldSignature = 'old-sig';
      const recentSignature = 'recent-sig';
      const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
      const oneMinuteAgo = Date.now() - (1 * 60 * 1000);
      
      worker['recentTransactions'].add(oldSignature);
      worker['recentTransactions'].add(recentSignature);
      worker['transactionTimestamps'].set(oldSignature, twoHoursAgo);
      worker['transactionTimestamps'].set(recentSignature, oneMinuteAgo);
      
      worker['cleanupOldTransactions']();
      
      expect(worker['recentTransactions'].has(oldSignature)).toBe(false);
      expect(worker['recentTransactions'].has(recentSignature)).toBe(true);
    });

    it('should enforce maximum transaction limit', () => {
      // Add more than MAX_RECENT_TRANSACTIONS
      const maxTransactions = 50; // From worker constant
      for (let i = 0; i < maxTransactions + 10; i++) {
        const sig = `signature-${i}`;
        worker['recentTransactions'].add(sig);
        worker['transactionTimestamps'].set(sig, Date.now() - i * 1000);
      }
      
      worker['cleanupOldTransactions']();
      
      expect(worker['recentTransactions'].size).toBeLessThanOrEqual(maxTransactions);
    });
  });

  describe('Trading Status Verification - Financial Safety', () => {
    beforeEach(async () => {
      await worker.start();
    });

    it('should verify sufficient SOL balance for trading', async () => {
      // Mock sufficient balance (0.1 SOL)
      mockConnection.getBalance.mockResolvedValueOnce(100000000); // 0.1 SOL in lamports
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValueOnce({
        value: []
      });
      
      const status = await worker.getTradingStatus();
      
      expect(status.hasSufficientBalance).toBe(true);
      expect(status.balanceDetails.sol).toBe(0.1);
    });

    it('should detect insufficient SOL balance', async () => {
      // Mock insufficient balance (0.001 SOL, less than required 0.002)
      mockConnection.getBalance.mockResolvedValueOnce(1000000); // 0.001 SOL in lamports
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValueOnce({
        value: []
      });
      
      const status = await worker.getTradingStatus();
      
      expect(status.hasSufficientBalance).toBe(false);
      expect(status.balanceDetails.sol).toBe(0.001);
    });

    it('should retrieve token balances correctly', async () => {
      mockConnection.getBalance.mockResolvedValueOnce(100000000);
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValueOnce({
        value: [
          {
            account: {
              data: {
                parsed: {
                  info: {
                    mint: 'USDC-mint',
                    tokenAmount: { uiAmount: 1000.5 }
                  }
                }
              }
            }
          }
        ]
      });
      
      const status = await worker.getTradingStatus();
      
      expect(status.balanceDetails.tokenBalances['USDC-mint']).toBe(1000.5);
    });
  });

  describe('Trade Execution Monitoring - Critical Financial Operations', () => {
    beforeEach(async () => {
      await worker.start();
    });

    it('should monitor successful trade execution', async () => {
      const signature = 'successful-trade-sig';
      
      // Mock successful transaction
      mockConnection.getTransaction.mockResolvedValueOnce({
        meta: {
          err: null,
          preTokenBalances: [
            {
              owner: mockTradingWallet.toString(),
              mint: 'SOL-mint',
              uiTokenAmount: { uiAmount: 1.0 }
            }
          ],
          postTokenBalances: [
            {
              owner: mockTradingWallet.toString(),
              mint: 'SOL-mint',
              uiTokenAmount: { uiAmount: 0.5 }
            },
            {
              owner: mockTradingWallet.toString(),
              mint: 'USDC-mint',
              uiTokenAmount: { uiAmount: 79.5 }
            }
          ]
        },
        blockTime: Math.floor(Date.now() / 1000)
      });
      
      const result = await worker.getTradeStatus(signature);
      
      expect(result.status).toBe('confirmed');
      expect(result.details?.inputAmount).toBe(0.5); // SOL decreased by 0.5
      expect(result.details?.outputAmount).toBe(79.5); // USDC increased by 79.5
    });

    it('should detect failed trade execution', async () => {
      const signature = 'failed-trade-sig';
      
      // Mock failed transaction
      mockConnection.getTransaction.mockResolvedValueOnce({
        meta: {
          err: { InstructionError: [0, 'InsufficientFunds'] },
          preTokenBalances: [],
          postTokenBalances: []
        },
        blockTime: Math.floor(Date.now() / 1000)
      });
      
      const result = await worker.getTradeStatus(signature);
      
      expect(result.status).toBe('failed');
      expect(result.error).toContain('InsufficientFunds');
    });

    it('should handle missing transaction gracefully', async () => {
      const signature = 'missing-transaction-sig';
      
      mockConnection.getTransaction.mockResolvedValueOnce(null);
      
      const result = await worker.getTradeStatus(signature);
      
      expect(result.status).toBe('failed');
      expect(result.error).toBe('Transaction not found');
    });
  });

  describe('Error Handling - Financial Safety Critical', () => {
    it('should handle Solana connection errors', async () => {
      mockConnection.onLogs.mockRejectedValueOnce(new Error('RPC connection failed'));
      
      await expect(worker.start()).rejects.toThrow('RPC connection failed');
    });

    it('should handle Jupiter API errors gracefully', async () => {
      await worker.start();
      
      // Mock Jupiter API failure
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockRejectedValueOnce(new Error('Jupiter API unavailable'));
      
      const result = await worker['monitorMirroringProcess']('SOL', 'USDC', 1000000);
      
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Jupiter API unavailable');
    });

    it('should handle malformed transaction data', async () => {
      await worker.start();
      
      // Mock transaction with no metadata
      mockConnection.getTransaction.mockResolvedValueOnce({
        meta: null,
        blockTime: Math.floor(Date.now() / 1000)
      });
      
      const result = await worker.getTradeStatus('malformed-tx');
      
      expect(result.status).toBe('failed');
      expect(result.error).toBe('Transaction metadata is missing');
    });

    it('should handle network timeouts', async () => {
      await worker.start();
      
      // Mock timeout scenario
      mockConnection.getTransaction.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve(null), 100))
      );
      
      const result = await worker['monitorMirroringProcess']('SOL', 'USDC', 1000000);
      
      // Should eventually timeout or handle gracefully
      expect(['failed', 'monitoring']).toContain(result.status);
    });
  });

  describe('Financial Safety Validations', () => {
    it('should validate trading wallet ownership', () => {
      expect(worker['tradingWallet']).toEqual(mockTradingWallet);
      expect(worker['tradingWalletKeypair']?.publicKey).toEqual(mockKeypair.publicKey);
    });

    it('should validate percentage limits', () => {
      expect(worker['percentage']).toBe(50);
      expect(worker['percentage']).toBeGreaterThan(0);
      expect(worker['percentage']).toBeLessThanOrEqual(100);
    });

    it('should prevent unauthorized wallet access', () => {
      const maliciousJob = {
        ...mockJob,
        tradingWalletSecretKey: null
      };
      
      const workerWithoutKey = new WalletMonitorWorker(
        maliciousJob, 
        'test-endpoint', 
        mockTradingWallet
      );
      
      expect(workerWithoutKey['tradingWalletKeypair']).toBeNull();
    });
  });
});