import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { LevelsWorker } from '../../workers/LevelsWorker';
import { VaultWorker } from '../../workers/VaultWorker';
import { PriceMonitorWorker } from '../../workers/PriceMonitorWorker';
import { SwapService } from '../../services/swap.service';
import { LevelsStrategy, VaultStrategy, PriceMonitoringJob, JobType } from '../../types/jobs';
import { PublicKey, Keypair, Connection } from '@solana/web3.js';
import { Pool } from 'pg';

describe('End-to-End Trading Workflow Tests', () => {
  let mockPool: Pool;
  let mockConnection: Connection;
  let mockSwapService: SwapService;
  let tradingKeypair: Keypair;
  let mainWalletKeypair: Keypair;

  beforeEach(() => {
    jest.clearAllMocks();
    
    tradingKeypair = Keypair.generate();
    mainWalletKeypair = Keypair.generate();
    
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn()
    } as any;

    mockConnection = {
      getBalance: jest.fn(),
      getRecentBlockhash: jest.fn().mockResolvedValue({ blockhash: 'test-blockhash' }),
      sendRawTransaction: jest.fn().mockResolvedValue('test-signature'),
      confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
      requestAirdrop: jest.fn(),
    } as any;

    mockSwapService = new SwapService(mockPool, mockConnection, null);
    
    // Mock successful swap by default
    jest.spyOn(mockSwapService, 'executeSwap').mockResolvedValue({
      signature: 'swap-success-signature',
      inputAmount: '1000000000',
      outputAmount: '200000000',
      message: 'Swap completed successfully'
    });

    // Mock Jupiter price API  
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          'So11111111111111111111111111111111111111112': {
            price: 200
          }
        }
      })
    } as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Complete Levels Trading Workflow', () => {
    it('should execute full levels trading cycle with profit tracking', async () => {
      const levelsJob: LevelsStrategy = {
        id: 'e2e-levels-test',
        type: JobType.LEVELS,
        tradingWalletPublicKey: tradingKeypair.publicKey.toString(),
        tradingWalletSecretKey: tradingKeypair.secretKey,
        levels: [
          { price: 190, percentage: 30 }, // Buy level  
          { price: 210, percentage: 30 }, // Sell level
        ],
        isActive: true,
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        lastTriggerPrice: 180, // Start below both levels
        profitTracking: {
          initialBalance: 10,
          currentBalance: 10,
          totalProfit: 0,
          profitHistory: [],
          trades: []
        }
      };

      const worker = new LevelsWorker(levelsJob, 'https://api.mainnet-beta.solana.com', mockSwapService);
      (worker as any).connection = mockConnection;
      
      // Setup initial balance
      mockConnection.getBalance = jest.fn().mockResolvedValue(10 * 1e9); // 10 SOL
      
      // Scenario 1: Price rises to 200 (crosses 190 buy level from below)
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            'So11111111111111111111111111111111111111112': {
              price: 200 // Above buy level
            }
          }
        })
      } as Response);

      await (worker as any).checkLevels();

      // Verify buy trade was executed
      expect(mockSwapService.executeSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: expect.any(Number), // 30% of balance
          slippageBps: 50 // Default slippage
        })
      );

      // Verify profit tracking was updated
      expect(levelsJob.profitTracking.trades).toHaveLength(1);
      expect(levelsJob.profitTracking.trades[0].type).toBe('buy');
      expect(levelsJob.profitTracking.trades[0].amount).toBe(3); // 30% of 10 SOL
      
      // Verify state tracking
      expect(levelsJob.lastTriggerPrice).toBe(200);
      expect(levelsJob.lastActivity).toBeTruthy();
    });

    it('should handle multiple level crossings in single price movement', async () => {
      const levelsJob: LevelsStrategy = {
        id: 'multi-level-test',
        type: JobType.LEVELS,
        tradingWalletPublicKey: tradingKeypair.publicKey.toString(),
        tradingWalletSecretKey: tradingKeypair.secretKey,
        levels: [
          { price: 180, percentage: 25 },
          { price: 200, percentage: 25 },
          { price: 220, percentage: 25 },
        ],
        isActive: true,
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        lastTriggerPrice: 170, // Start below all levels
        profitTracking: {
          initialBalance: 12,
          currentBalance: 12,
          totalProfit: 0,
          profitHistory: [],
          trades: []
        }
      };

      const worker = new LevelsWorker(levelsJob, 'https://api.mainnet-beta.solana.com', mockSwapService);
      (worker as any).connection = mockConnection;
      
      mockConnection.getBalance = jest.fn().mockResolvedValue(12 * 1e9);
      
      // Price jumps from 170 to 230 (crosses all 3 levels)
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            'So11111111111111111111111111111111111111112': {
              price: 230
            }
          }
        })
      } as Response);

      await (worker as any).checkLevels();

      // Should execute 3 trades (one for each crossed level)
      expect(mockSwapService.executeSwap).toHaveBeenCalledTimes(3);
      expect(levelsJob.profitTracking.trades).toHaveLength(3);
      
      // Each trade should be 25% of 12 SOL = 3 SOL
      levelsJob.profitTracking.trades.forEach(trade => {
        expect(trade.amount).toBe(3);
        expect(trade.type).toBe('sell'); // Crossing upward = sell
      });
    });
  });

  describe('Complete Vault Strategy Workflow', () => {
    it('should execute full vault rebalancing with slippage retries', async () => {
      const vaultJob: VaultStrategy = {
        id: 'e2e-vault-test',
        type: JobType.VAULT,
        tradingWalletPublicKey: tradingKeypair.publicKey.toString(),
        tradingWalletSecretKey: tradingKeypair.secretKey,
        mainWalletPublicKey: mainWalletKeypair.publicKey.toString(),
        vaultPercentage: 3.0, // 3% vault allocation
        isActive: true,
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        profitTracking: {
          initialBalance: 20,
          currentBalance: 20,
          totalProfit: 0,
          profitHistory: [],
          trades: []
        }
      };

      const worker = new VaultWorker(vaultJob, 'https://api.mainnet-beta.solana.com', mockSwapService);
      (worker as any).connection = mockConnection;
      
      // Setup: Trading wallet has 20 SOL, main wallet has 0 (vault is under-allocated)
      mockConnection.getBalance = jest.fn()
        .mockResolvedValueOnce(20 * 1e9)  // Trading wallet: 20 SOL
        .mockResolvedValueOnce(0);        // Main wallet: 0 SOL (should have 0.6 SOL = 3% of 20)
      
      // Mock swap service to fail first attempt (slippage), succeed on retry
      jest.spyOn(mockSwapService, 'executeSwap')
        .mockRejectedValueOnce(new Error('Slippage tolerance exceeded'))
        .mockResolvedValueOnce({
          signature: 'vault-swap-retry-success',
          inputAmount: '600000000', // 0.6 SOL in lamports
          outputAmount: '600000000', // Already SOL
          message: 'Token swap completed (succeeded with 1.5% slippage after 2 attempts)'
        });

      await (worker as any).checkAndRebalance();

      // Verify swap was attempted twice (progressive slippage)
      expect(mockSwapService.executeSwap).toHaveBeenCalledTimes(2);
      
      // Verify SOL transfer to main wallet was executed
      expect(mockConnection.sendRawTransaction).toHaveBeenCalled();
      expect(mockConnection.confirmTransaction).toHaveBeenCalled();
      
      // Verify activity tracking
      expect(vaultJob.lastActivity).toBeTruthy();
    });

    it('should enforce 5% maximum vault allocation limit', () => {
      const excessiveVaultJob: VaultStrategy = {
        id: 'excessive-vault-test',
        type: JobType.VAULT,
        tradingWalletPublicKey: tradingKeypair.publicKey.toString(),
        tradingWalletSecretKey: tradingKeypair.secretKey,
        mainWalletPublicKey: mainWalletKeypair.publicKey.toString(),
        vaultPercentage: 8.0, // 8% - should be capped at 5%
        isActive: true,
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        profitTracking: {
          initialBalance: 10,
          currentBalance: 10,
          totalProfit: 0,
          profitHistory: [],
          trades: []
        }
      };

      const worker = new VaultWorker(excessiveVaultJob, 'https://api.mainnet-beta.solana.com', mockSwapService);
      
      // Verify vault percentage was capped
      expect((worker as any).vaultPercentage).toBe(5);
    });
  });

  describe('Price Monitor Complete Workflow', () => {
    it('should execute complete price monitoring with target achievement', async () => {
      const priceMonitorJob: PriceMonitoringJob = {
        id: 'e2e-price-monitor-test',
        type: JobType.PRICE_MONITOR,
        tradingWalletPublicKey: tradingKeypair.publicKey.toString(),
        tradingWalletSecretKey: tradingKeypair.secretKey,
        targetPrice: 180,
        direction: 'below',
        percentageToSell: 40, // 40% of SOL
        isActive: true,
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        profitTracking: {
          initialBalance: 8,
          currentBalance: 8,
          totalProfit: 0,
          profitHistory: [],
          trades: []
        }
      };

      const worker = new PriceMonitorWorker(priceMonitorJob, 'https://api.mainnet-beta.solana.com');
      (worker as any).connection = mockConnection;
      
      mockConnection.getBalance = jest.fn().mockResolvedValue(8 * 1e9); // 8 SOL
      
      // Mock price dropping below target (200 -> 170)
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            'So11111111111111111111111111111111111111112': {
              price: 170 // Below target of 180
            }
          }
        })
      });

      // Mock Jupiter swap API calls that PriceMonitorWorker makes internally
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            inputMint: 'So11111111111111111111111111111111111111112',
            outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            inAmount: '3200000000', // 3.2 SOL (40% of 8)
            outAmount: '544000000', // Mock USDC output
            slippageBps: 50
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            swapTransaction: 'base64encodedtransaction', // Mock transaction
            lastValidBlockHeight: 1000000
          })
        });

      await (worker as any).checkPrice();

      // Verify the monitoring detected the price condition
      expect(priceMonitorJob.lastTriggerPrice).toBe(170);
      
      // Verify activity was updated
      expect(priceMonitorJob.lastActivity).toBeTruthy();
      
      // Verify trigger history was recorded
      expect(priceMonitorJob.triggerHistory).toBeTruthy();
      expect(priceMonitorJob.triggerHistory?.length).toBe(1);
      expect(priceMonitorJob.triggerHistory?.[0].price).toBe(170);
      expect(priceMonitorJob.triggerHistory?.[0].amount).toBe(3.2);
    });
  });

  describe('Cross-Strategy Integration Scenarios', () => {
    it('should handle multiple strategies operating on same wallet without conflicts', async () => {
      // Create multiple strategies for the same trading wallet
      const levelsJob: LevelsStrategy = {
        id: 'multi-strategy-levels',
        type: JobType.LEVELS,
        tradingWalletPublicKey: tradingKeypair.publicKey.toString(),
        tradingWalletSecretKey: tradingKeypair.secretKey,
        levels: [{ price: 200, percentage: 20 }],
        isActive: true,
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        lastTriggerPrice: 180,
        profitTracking: {
          initialBalance: 15,
          currentBalance: 15,
          totalProfit: 0,
          profitHistory: [],
          trades: []
        }
      };

      const vaultJob: VaultStrategy = {
        id: 'multi-strategy-vault',
        type: JobType.VAULT,
        tradingWalletPublicKey: tradingKeypair.publicKey.toString(),
        tradingWalletSecretKey: tradingKeypair.secretKey,
        mainWalletPublicKey: mainWalletKeypair.publicKey.toString(),
        vaultPercentage: 2.0,
        isActive: true,
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        profitTracking: {
          initialBalance: 15,
          currentBalance: 15,
          totalProfit: 0,
          profitHistory: [],
          trades: []
        }
      };

      const levelsWorker = new LevelsWorker(levelsJob, 'https://api.mainnet-beta.solana.com', mockSwapService);
      const vaultWorker = new VaultWorker(vaultJob, 'https://api.mainnet-beta.solana.com', mockSwapService);
      
      (levelsWorker as any).connection = mockConnection;
      (vaultWorker as any).connection = mockConnection;

      // Setup wallet balances
      mockConnection.getBalance = jest.fn()
        .mockResolvedValue(15 * 1e9); // Trading wallet has 15 SOL

      // Mock price crossing levels threshold
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            'So11111111111111111111111111111111111111112': {
              price: 210 // Above levels threshold
            }
          }
        })
      });

      // Execute both strategies
      await Promise.all([
        (levelsWorker as any).checkLevels(),
        (vaultWorker as any).checkAndRebalance()
      ]);

      // Verify both strategies executed without interference
      expect(levelsJob.lastTriggerPrice).toBe(210);
      expect(vaultJob.lastActivity).toBeTruthy();
      
      // Verify they recorded their activities independently
      expect(levelsJob.profitTracking.trades).toHaveLength(1);
      expect(levelsJob.profitTracking.trades[0].amount).toBe(3); // 20% of 15 SOL
    });

    it('should handle progressive slippage consistently across all strategies', async () => {
      const strategies = [
        {
          name: 'Levels Strategy',
          execute: async () => {
            const job: LevelsStrategy = {
              id: 'slippage-test-levels',
              type: JobType.LEVELS,
              tradingWalletPublicKey: tradingKeypair.publicKey.toString(),
              tradingWalletSecretKey: tradingKeypair.secretKey,
              levels: [{ price: 200, percentage: 25 }],
              isActive: true,
              lastActivity: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              lastTriggerPrice: 180,
              profitTracking: {
                initialBalance: 10,
                currentBalance: 10,
                totalProfit: 0,
                profitHistory: [],
                trades: []
              }
            };
            
            const worker = new LevelsWorker(job, 'https://api.mainnet-beta.solana.com', mockSwapService);
            (worker as any).connection = mockConnection;
            mockConnection.getBalance = jest.fn().mockResolvedValue(10 * 1e9);
            
            // Mock price crossing
            (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
              ok: true,
              json: async () => ({
                data: {
                  'So11111111111111111111111111111111111111112': {
                    price: 220
                  }
                }
              })
            });
            
            return (worker as any).checkLevels();
          }
        },
        {
          name: 'Vault Strategy',
          execute: async () => {
            const job: VaultStrategy = {
              id: 'slippage-test-vault',
              type: JobType.VAULT,
              tradingWalletPublicKey: tradingKeypair.publicKey.toString(),
              tradingWalletSecretKey: tradingKeypair.secretKey,
              mainWalletPublicKey: mainWalletKeypair.publicKey.toString(),
              vaultPercentage: 1.0,
              isActive: true,
              lastActivity: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              profitTracking: {
                initialBalance: 20,
                currentBalance: 20,
                totalProfit: 0,
                profitHistory: [],
                trades: []
              }
            };
            
            const worker = new VaultWorker(job, 'https://api.mainnet-beta.solana.com', mockSwapService);
            (worker as any).connection = mockConnection;
            
            // Setup imbalanced vault
            mockConnection.getBalance = jest.fn()
              .mockResolvedValueOnce(20 * 1e9)  // Trading: 20 SOL
              .mockResolvedValueOnce(0);        // Main: 0 SOL (needs 0.2)
            
            return (worker as any).checkAndRebalance();
          }
        }
      ];

      // Mock all strategies to fail with slippage initially, then succeed
      jest.spyOn(mockSwapService, 'executeSwap')
        .mockRejectedValueOnce(new Error('Slippage tolerance exceeded'))
        .mockResolvedValueOnce({
          signature: 'levels-slippage-retry',
          inputAmount: '2500000000',
          outputAmount: '500000000',
          message: 'Swap completed (succeeded with 1.5% slippage after 2 attempts)'
        })
        .mockRejectedValueOnce(new Error('Slippage tolerance exceeded'))
        .mockResolvedValueOnce({
          signature: 'vault-slippage-retry',
          inputAmount: '200000000',
          outputAmount: '200000000',
          message: 'Swap completed (succeeded with 1.5% slippage after 2 attempts)'
        });

      // Execute all strategies
      for (const strategy of strategies) {
        await strategy.execute();
      }

      // Verify all strategies handled slippage retries
      expect(mockSwapService.executeSwap).toHaveBeenCalledTimes(4); // 2 retries per strategy
      
      // Verify consistent slippage progression was used
      const executeSwapCalls = (mockSwapService.executeSwap as jest.Mock).mock.calls;
      executeSwapCalls.forEach((call, index) => {
        const request = call[0];
        // First call should use original slippage, retries should use progressive values
        if (index % 2 === 0) {
          expect(request.slippageBps).toBe(50); // Original 0.5%
        } else {
          expect([150, 300, 500]).toContain(request.slippageBps); // Progressive slippage
        }
      });
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover gracefully from network failures', async () => {
      const levelsJob: LevelsStrategy = {
        id: 'network-failure-test',
        type: JobType.LEVELS,
        tradingWalletPublicKey: tradingKeypair.publicKey.toString(),
        tradingWalletSecretKey: tradingKeypair.secretKey,
        levels: [{ price: 200, percentage: 30 }],
        isActive: true,
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        lastTriggerPrice: 180,
        profitTracking: {
          initialBalance: 10,
          currentBalance: 10,
          totalProfit: 0,
          profitHistory: [],
          trades: []
        }
      };

      const worker = new LevelsWorker(levelsJob, 'https://api.mainnet-beta.solana.com', mockSwapService);
      (worker as any).connection = mockConnection;
      
      // Mock network failure for price fetch
      (global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
        new Error('Network request failed')
      );

      // Should throw the network error
      await expect((worker as any).checkLevels())
        .rejects.toThrow('Network request failed');
      
      // State should remain unchanged
      expect(levelsJob.lastTriggerPrice).toBe(180);
      expect(levelsJob.profitTracking.trades).toHaveLength(0);
    });

    it('should handle partial failures in multi-level trading', async () => {
      const levelsJob: LevelsStrategy = {
        id: 'partial-failure-test',
        type: JobType.LEVELS,
        tradingWalletPublicKey: tradingKeypair.publicKey.toString(),
        tradingWalletSecretKey: tradingKeypair.secretKey,
        levels: [
          { price: 190, percentage: 25 },
          { price: 210, percentage: 25 },
        ],
        isActive: true,
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        lastTriggerPrice: 180,
        profitTracking: {
          initialBalance: 10,
          currentBalance: 10,
          totalProfit: 0,
          profitHistory: [],
          trades: []
        }
      };

      const worker = new LevelsWorker(levelsJob, 'https://api.mainnet-beta.solana.com', mockSwapService);
      (worker as any).connection = mockConnection;
      
      mockConnection.getBalance = jest.fn().mockResolvedValue(10 * 1e9);
      
      // Price crosses both levels
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            'So11111111111111111111111111111111111111112': {
              price: 220 // Crosses both 190 and 210
            }
          }
        })
      });

      // Mock first trade succeeding, second failing
      jest.spyOn(mockSwapService, 'executeSwap')
        .mockResolvedValueOnce({
          signature: 'first-trade-success',
          inputAmount: '2500000000',
          outputAmount: '475000000',
          message: 'First trade successful'
        })
        .mockRejectedValueOnce(new Error('Insufficient balance for second trade'));

      // Should throw error but first trade should have been recorded
      await expect((worker as any).checkLevels())
        .rejects.toThrow('Insufficient balance for second trade');
      
      // Verify first trade was recorded despite second trade failure
      expect(levelsJob.profitTracking.trades).toHaveLength(1);
      expect(levelsJob.profitTracking.trades[0].amount).toBe(2.5);
      
      // State should be updated to reflect the price change
      expect(levelsJob.lastTriggerPrice).toBe(220);
    });
  });

  describe('Performance and Resource Management', () => {
    it('should efficiently handle concurrent strategy operations', async () => {
      const startTime = Date.now();
      
      // Create multiple strategies running concurrently
      const strategies = Array.from({ length: 5 }, (_, i) => ({
        id: `concurrent-test-${i}`,
        type: JobType.LEVELS as const,
        tradingWalletPublicKey: tradingKeypair.publicKey.toString(),
        tradingWalletSecretKey: tradingKeypair.secretKey,
        levels: [{ price: 200 + i * 10, percentage: 20 }],
        isActive: true,
        lastActivity: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        lastTriggerPrice: 180,
        profitTracking: {
          initialBalance: 10,
          currentBalance: 10,
          totalProfit: 0,
          profitHistory: [],
          trades: []
        }
      }));

      const workers = strategies.map(job => {
        const worker = new LevelsWorker(job, 'https://api.mainnet-beta.solana.com', mockSwapService);
        (worker as any).connection = mockConnection;
        return worker;
      });

      mockConnection.getBalance = jest.fn().mockResolvedValue(10 * 1e9);
      
      // Mock price that crosses all levels
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            'So11111111111111111111111111111111111111112': {
              price: 250
            }
          }
        })
      });

      // Execute all strategies concurrently
      await Promise.all(
        workers.map(worker => (worker as any).checkLevels())
      );

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      
      // Should complete all 5 strategies within reasonable time (< 5 seconds)
      expect(executionTime).toBeLessThan(5000);
      
      // All strategies should have executed their trades
      expect(mockSwapService.executeSwap).toHaveBeenCalledTimes(5);
      
      // Verify each strategy recorded its trade
      strategies.forEach(strategy => {
        expect(strategy.profitTracking.trades).toHaveLength(1);
        expect(strategy.lastTriggerPrice).toBe(250);
      });
    });
  });
});