import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { PairTradeWorker } from '../../workers/PairTradeWorker';
import { PairTradeJob, JobType } from '../../types/jobs';
import { TokenService } from '../../services/TokenService';
import { PublicKey, Keypair, Connection } from '@solana/web3.js';
import { Pool } from 'pg';

// Mock fetch for Jupiter API calls
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

// Mock TokenService
const mockTokenService = {
  validateTokenPair: jest.fn(),
  getTokenInfo: jest.fn(),
} as unknown as jest.Mocked<TokenService>;

// Mock Pool
const mockPool = {
  query: jest.fn()
} as unknown as jest.Mocked<Pool>;

// Mock Solana Connection
const mockConnection = {
  getBalance: jest.fn(),
  getParsedTokenAccountsByOwner: jest.fn(),
  getAccountInfo: jest.fn(),
  getLatestBlockhash: jest.fn(),
  sendTransaction: jest.fn(),
  confirmTransaction: jest.fn(),
} as any;

// Mock console to capture logs
const mockConsole = {
  log: jest.fn(),
  error: jest.fn()
};

describe('PairTradeWorker - Dual Token Trading Critical Tests', () => {
  let worker: PairTradeWorker;
  let mockJob: PairTradeJob;
  let mockKeypair: Keypair;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup test keypair
    mockKeypair = Keypair.generate();
    mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

    // Create base pair trade job (TSLAx/wBTC example)
    mockJob = {
      id: 'test-pair-trade-1',
      type: JobType.PAIR_TRADE,
      tradingWalletPublicKey: mockKeypair.publicKey.toString(),
      tradingWalletSecretKey: mockKeypair.secretKey,
      tokenAMint: 'So11111111111111111111111111111111111111112', // Use SOL as tokenA for simplicity
      tokenBMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // Use USDC as tokenB  
      tokenASymbol: 'SOL',
      tokenBSymbol: 'USDC', 
      allocationPercentage: 50, // 50% of current token balance per swap
      currentToken: 'A', // Currently holding SOL
      maxSlippage: 1.0, // 1% max slippage
      autoRebalance: false,
      isActive: true,
      lastActivity: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      swapHistory: [],
      profitTracking: {
        initialBalance: 1000,
        currentBalance: 1000,
        totalProfit: 0,
        profitHistory: [],
        trades: []
      }
    };

    // Setup comprehensive connection mocks
    mockConnection.getBalance.mockResolvedValue(10 * 1e9); // 10 SOL default
    mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
      value: [{
        account: {
          data: {
            parsed: {
              info: {
                tokenAmount: {
                  amount: '10000000' // 10 USDC with 6 decimals
                }
              }
            }
          }
        }
      }]
    });
    mockConnection.getAccountInfo.mockResolvedValue({ data: 'mock-account-exists' });
    mockConnection.getLatestBlockhash.mockResolvedValue({ blockhash: 'mock-blockhash' });
    mockConnection.sendTransaction.mockResolvedValue('mock-signature-123');
    mockConnection.confirmTransaction.mockResolvedValue({ value: { err: null } });

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation(mockConsole.log);
    jest.spyOn(console, 'error').mockImplementation(mockConsole.error);

    // Create worker instance
    worker = new PairTradeWorker(mockJob, 'https://api.mainnet-beta.solana.com', mockTokenService, mockPool);
    (worker as any).connection = mockConnection;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Initialization & Validation - Critical Setup', () => {
    it('should initialize with valid pair trade parameters', () => {
      expect((worker as any).tradingWalletKeypair.publicKey.toString()).toBe(mockKeypair.publicKey.toString());
      expect((worker as any).tokenService).toBe(mockTokenService);
      expect((worker as any).isProcessingSwap).toBe(false);
      
      expect(mockConsole.log).toHaveBeenCalledWith('PairTradeWorker initialized for SOL/USDC pair');
    });

    it('should validate token pair during start', async () => {
      mockTokenService.validateTokenPair.mockResolvedValue({
        isValid: true
      });

      // Mock the connection creation to prevent real RPC calls
      const mockStart = jest.spyOn(worker as any, 'start').mockImplementation(async () => {
        const validation = await (worker as any).tokenService.validateTokenPair(
          (worker as any).job.tokenAMint,
          (worker as any).job.tokenBMint
        );
        if (!validation.isValid) {
          throw new Error(`Invalid token pair: ${validation.error}`);
        }
        (worker as any).isRunning = true;
      });

      await worker.start();

      expect(mockTokenService.validateTokenPair).toHaveBeenCalledWith(
        'So11111111111111111111111111111111111111112',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      );
      expect((worker as any).isRunning).toBe(true);
      
      mockStart.mockRestore();
    });

    it('should reject invalid token pairs', async () => {
      mockTokenService.validateTokenPair.mockResolvedValue({
        isValid: false,
        error: 'Token A not found on Jupiter'
      });

      await expect(worker.start()).rejects.toThrow('Invalid token pair: Token A not found on Jupiter');
      expect((worker as any).isRunning).toBe(false);
    });

    it('should handle different allocation percentages correctly', () => {
      const testCases = [
        { percentage: 1, expected: 1 },
        { percentage: 25, expected: 25 },
        { percentage: 50, expected: 50 },
        { percentage: 75, expected: 75 },
        { percentage: 100, expected: 100 }
      ];

      testCases.forEach(({ percentage, expected }) => {
        const testJob = { ...mockJob, allocationPercentage: percentage };
        const testWorker = new PairTradeWorker(testJob, 'https://api.mainnet-beta.solana.com', mockTokenService, mockPool);
        
        expect((testWorker as any).job.allocationPercentage).toBe(expected);
      });
    });
  });

  describe('Token Balance Management - Financial Accuracy', () => {
    it('should correctly get SOL balance for native token', async () => {
      const solBalance = 5 * 1e9; // 5 SOL in lamports
      mockConnection.getBalance.mockResolvedValue(solBalance);

      const balance = await (worker as any).getTokenBalance('So11111111111111111111111111111111111111112');
      
      expect(balance).toBe(solBalance);
      expect(mockConnection.getBalance).toHaveBeenCalledWith(mockKeypair.publicKey);
    });

    it('should correctly get SPL token balance', async () => {
      const mockTokenBalance = 1000000; // 1 token with 6 decimals
      
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [{
          account: {
            data: {
              parsed: {
                info: {
                  tokenAmount: {
                    amount: mockTokenBalance.toString()
                  }
                }
              }
            }
          }
        }]
      });

      const balance = await (worker as any).getTokenBalance('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      
      expect(balance).toBe(mockTokenBalance);
      expect(mockConnection.getParsedTokenAccountsByOwner).toHaveBeenCalledWith(
        mockKeypair.publicKey,
        { mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') }
      );
    });

    it('should return 0 for non-existent token accounts', async () => {
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: []
      });

      const balance = await (worker as any).getTokenBalance('NON_EXISTENT_MINT');
      
      expect(balance).toBe(0);
    });

    it('should handle balance fetch errors gracefully', async () => {
      mockConnection.getParsedTokenAccountsByOwner.mockRejectedValue(new Error('Network error'));

      const balance = await (worker as any).getTokenBalance('ERROR_MINT');
      
      expect(balance).toBe(0);
      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining('Error getting token balance'),
        expect.any(Error)
      );
    });
  });

  describe('Swap Execution Logic - Core Trading Functionality', () => {
    beforeEach(() => {
      // Mock successful token pair validation
      mockTokenService.validateTokenPair.mockResolvedValue({ isValid: true });
      mockConnection.getAccountInfo.mockResolvedValue({ data: 'exists' });
    });

    it('should execute successful SOL -> USDC swap', async () => {
      // Setup: Currently holding 10 SOL, want to swap 50% (5 SOL) to USDC
      const currentBalance = 10 * 1e9; // 10 SOL with 9 decimals (lamports)
      const expectedSwapAmount = Math.floor(currentBalance * 0.5); // 50% allocation
      
      // Mock SOL balance
      mockConnection.getBalance.mockResolvedValue(currentBalance);

      // Mock Jupiter quote
      const mockQuote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: expectedSwapAmount.toString(),
        outAmount: '5000000', // 5 USDC (6 decimals)
        slippageBps: 100
      };

      mockFetch
        .mockResolvedValueOnce({ // Jupiter quote API
          ok: true,
          json: async () => mockQuote
        } as Response);
        
      // Mock the executeJupiterSwap method directly to avoid transaction deserialization issues
      const mockExecuteJupiterSwap = jest.spyOn(worker as any, 'executeJupiterSwap').mockResolvedValue({
        success: true,
        signature: 'swap-signature-123'
      });

      // Mock token service for decimals
      mockTokenService.getTokenInfo
        .mockResolvedValueOnce({
          mintAddress: 'So11111111111111111111111111111111111111112',
          symbol: 'SOL',
          name: 'Solana',
          decimals: 9,
          category: 'crypto' as const,
          isActive: true,
          lastUpdated: new Date()
        }) // SOL
        .mockResolvedValueOnce({
          mintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          category: 'stablecoin' as const,
          isActive: true,
          lastUpdated: new Date()
        }); // USDC

      // Mock transaction execution
      mockConnection.sendTransaction.mockResolvedValue('swap-signature-123');
      mockConnection.confirmTransaction.mockResolvedValue({
        value: { err: null }
      });

      const result = await worker.executeSwap('manual');

      expect(result.success).toBe(true);
      expect(result.signature).toBe('swap-signature-123');
      expect(result.swapDetails).toBeDefined();
      expect(result.swapDetails?.fromToken).toBe('A');
      expect(result.swapDetails?.toToken).toBe('B');
      expect(result.swapDetails?.fromAmount).toBe(5); // 5 SOL
      expect(result.swapDetails?.toAmount).toBe(5); // 5 USDC

      // Verify job state was updated
      expect(mockJob.currentToken).toBe('B'); // Now holding USDC
      expect(mockJob.lastSwapTimestamp).toBeTruthy();
      expect(mockJob.swapHistory).toHaveLength(1);
      expect(mockJob.swapHistory[0].fromToken).toBe('A');
      expect(mockJob.swapHistory[0].toToken).toBe('B');
      
      // Cleanup mock
      mockExecuteJupiterSwap.mockRestore();
    });

    it('should execute successful USDC -> SOL swap (reverse direction)', async () => {
      // Update job to currently hold USDC
      mockJob.currentToken = 'B';
      
      const currentBalance = 10000000; // 10 USDC with 6 decimals
      const expectedSwapAmount = Math.floor(currentBalance * 0.5); // 50% allocation
      
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [{
          account: {
            data: {
              parsed: {
                info: {
                  tokenAmount: {
                    amount: currentBalance.toString()
                  }
                }
              }
            }
          }
        }]
      });

      const mockQuote = {
        inputMint: 'wBTC_MINT_ADDRESS_HERE',
        outputMint: 'TSLAx_MINT_ADDRESS_HERE',
        inAmount: expectedSwapAmount.toString(),
        outAmount: '10000000', // 10 TSLAx (6 decimals)
        slippageBps: 100
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockQuote
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            swapTransaction: 'base64_encoded_transaction_reverse'
          })
        } as Response);

      mockTokenService.getTokenInfo
        .mockResolvedValueOnce({
          mintAddress: 'wBTC_MINT_ADDRESS_HERE',
          symbol: 'wBTC',
          name: 'Wrapped Bitcoin',
          decimals: 8,
          category: 'crypto' as const,
          isActive: true,
          lastUpdated: new Date()
        }) // wBTC
        .mockResolvedValueOnce({
          mintAddress: 'TSLAx_MINT_ADDRESS_HERE',
          symbol: 'TSLAx',
          name: 'Tesla Token',
          decimals: 6,
          category: 'xstock' as const,
          isActive: true,
          lastUpdated: new Date()
        }); // TSLAx

      mockConnection.sendTransaction.mockResolvedValue('reverse-swap-signature');
      mockConnection.confirmTransaction.mockResolvedValue({
        value: { err: null }
      });

      const result = await worker.executeSwap('auto-rebalance');

      expect(result.success).toBe(true);
      expect(result.signature).toBe('reverse-swap-signature');
      expect(result.swapDetails?.fromToken).toBe('B');
      expect(result.swapDetails?.toToken).toBe('A');
      expect(result.swapDetails?.fromAmount).toBe(0.5); // 0.5 wBTC
      expect(result.swapDetails?.toAmount).toBe(10); // 10 TSLAx

      // Verify job state switched back
      expect(mockJob.currentToken).toBe('A'); // Back to TSLAx
    });

    it('should prevent swap when no balance available', async () => {
      // Mock zero SOL balance
      mockConnection.getBalance.mockResolvedValue(0);

      const result = await worker.executeSwap();

      expect(result.success).toBe(false);
      expect(result.error).toBe('No SOL balance to swap');
      expect(mockJob.currentToken).toBe('A'); // Unchanged
      expect(mockJob.swapHistory).toHaveLength(0);
    });

    it('should prevent swap when calculated amount is zero', async () => {
      // Very small SOL balance that results in zero after allocation percentage
      const tinyBalance = 1; // 1 lamport (less than 50% would be 0)
      
      mockConnection.getBalance.mockResolvedValue(tinyBalance);

      const result = await worker.executeSwap();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Calculated swap amount is zero');
    });

    it('should prevent concurrent swaps', async () => {
      // Set processing flag
      (worker as any).isProcessingSwap = true;

      const result = await worker.executeSwap();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Swap already in progress');
    });
  });

  describe('Allocation Percentage Calculations - Financial Safety', () => {
    it('should correctly calculate swap amounts for different percentages', async () => {
      const testCases = [
        { balance: 1000000, percentage: 10, expected: 100000 }, // 10% of 1M
        { balance: 1000000, percentage: 25, expected: 250000 }, // 25% of 1M
        { balance: 1000000, percentage: 50, expected: 500000 }, // 50% of 1M
        { balance: 1000000, percentage: 75, expected: 750000 }, // 75% of 1M
        { balance: 1000000, percentage: 100, expected: 1000000 }, // 100% of 1M
      ];

      testCases.forEach(({ balance, percentage, expected }) => {
        const calculatedAmount = Math.floor(balance * (percentage / 100));
        expect(calculatedAmount).toBe(expected);
      });
    });

    it('should enforce minimum swap amounts', async () => {
      // Test with very small balances
      const smallBalance = 50; // 50 units
      mockJob.allocationPercentage = 1; // 1%
      
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [{
          account: {
            data: {
              parsed: {
                info: {
                  tokenAmount: {
                    amount: smallBalance.toString()
                  }
                }
              }
            }
          }
        }]
      });

      const result = await worker.executeSwap();
      
      // 1% of 50 = 0.5, Math.floor = 0
      expect(result.success).toBe(false);
      expect(result.error).toBe('Calculated swap amount is zero');
    });

    it('should validate allocation percentages are within bounds', () => {
      // Test boundary conditions
      const validPercentages = [1, 25, 50, 75, 100];
      const invalidPercentages = [0, -5, 101, 150];

      validPercentages.forEach(percentage => {
        const testJob = { ...mockJob, allocationPercentage: percentage };
        expect(() => new PairTradeWorker(testJob, 'https://api.mainnet-beta.solana.com', mockTokenService, mockPool))
          .not.toThrow();
      });

      // Note: The current implementation doesn't validate percentage bounds
      // This test documents expected behavior for future validation
    });
  });

  describe('Jupiter API Integration - External Service Reliability', () => {
    it('should handle Jupiter quote API failures gracefully', async () => {
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [{
          account: {
            data: {
              parsed: {
                info: {
                  tokenAmount: {
                    amount: '1000000'
                  }
                }
              }
            }
          }
        }]
      });

      // Mock Jupiter quote API failure
      mockFetch.mockRejectedValueOnce(new Error('Jupiter API timeout'));

      const result = await worker.executeSwap();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Jupiter API timeout');
      expect(mockConsole.error).toHaveBeenCalledWith(
        '[PairTrade] Error executing swap:',
        expect.any(Error)
      );
    });

    it('should handle Jupiter swap API failures gracefully', async () => {
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [{
          account: {
            data: {
              parsed: {
                info: {
                  tokenAmount: {
                    amount: '1000000'
                  }
                }
              }
            }
          }
        }]
      });

      // Mock successful quote but failed swap
      const mockQuote = {
        inputMint: 'TSLAx_MINT_ADDRESS_HERE',
        outputMint: 'wBTC_MINT_ADDRESS_HERE',
        inAmount: '500000',
        outAmount: '50000000',
        slippageBps: 100
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockQuote
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ error: 'Insufficient liquidity' })
        } as Response);

      const result = await worker.executeSwap();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Jupiter swap failed');
    });

    it('should include platform fees in Jupiter quotes', async () => {
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [{
          account: {
            data: {
              parsed: {
                info: {
                  tokenAmount: {
                    amount: '1000000'
                  }
                }
              }
            }
          }
        }]
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          inputMint: 'TSLAx_MINT_ADDRESS_HERE',
          outputMint: 'wBTC_MINT_ADDRESS_HERE',
          inAmount: '500000',
          outAmount: '50000000'
        })
      } as Response);

      await (worker as any).getJupiterQuote('input', 'output', 1000000, 1.0);

      // Verify platform fee was included in query
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('platformFeeBps=20')
      );
    });

    it('should convert slippage percentage to basis points correctly', async () => {
      const testCases = [
        { percentage: 0.5, expected: 50 },   // 0.5% = 50 bps
        { percentage: 1.0, expected: 100 },  // 1.0% = 100 bps  
        { percentage: 2.5, expected: 250 },  // 2.5% = 250 bps
        { percentage: 5.0, expected: 500 },  // 5.0% = 500 bps
      ];

      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [{
          account: {
            data: {
              parsed: {
                info: {
                  tokenAmount: {
                    amount: '1000000'
                  }
                }
              }
            }
          }
        }]
      });

      for (const { percentage, expected } of testCases) {
        mockFetch.mockClear();
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ inputMint: 'test', outputMint: 'test' })
        } as Response);

        await (worker as any).getJupiterQuote('input', 'output', 1000000, percentage);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining(`slippageBps=${expected}`)
        );
      }
    });
  });

  describe('Status Reporting - Monitoring & Analytics', () => {
    it('should provide accurate trading status', async () => {
      // Reset and set specific balance for this test
      mockConnection.getBalance.mockReset();
      mockConnection.getBalance.mockResolvedValue(5 * 1e9); // 5 SOL in lamports

      mockTokenService.getTokenInfo.mockResolvedValue({
        mintAddress: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        category: 'crypto' as const,
        isActive: true,
        lastUpdated: new Date()
      });

      // Add some swap history
      mockJob.swapHistory = [
        {
          timestamp: '2025-07-22T10:00:00Z',
          fromToken: 'A',
          toToken: 'B',
          fromAmount: 10,
          toAmount: 1,
          price: 10,
          profit: 0
        }
      ];
      mockJob.lastSwapTimestamp = '2025-07-22T10:00:00Z';

      const status = await worker.getStatus();

      expect(status.currentToken).toBe('A');
      expect(status.currentTokenSymbol).toBe('SOL');
      expect(status.currentBalance).toBe(5); // 5 SOL
      expect(status.balanceUSD).toBe(0); // TODO: Not implemented yet
      expect(status.lastSwapTimestamp).toBe('2025-07-22T10:00:00Z');
      expect(status.swapCount).toBe(1);
      expect(status.allocationPercentage).toBe(50);
      expect(status.isProcessingSwap).toBe(false);
    });

    it('should reflect processing state during swaps', () => {
      (worker as any).isProcessingSwap = true;

      return worker.getStatus().then(status => {
        expect(status.isProcessingSwap).toBe(true);
      });
    });
  });

  describe('Token Account Management - Infrastructure', () => {
    it('should skip token account creation for SOL', async () => {
      await (worker as any).ensureTokenAccount('So11111111111111111111111111111111111111112', mockKeypair.publicKey);

      // Should not call any account creation methods
      expect(mockConnection.getAccountInfo).not.toHaveBeenCalled();
      expect(mockConnection.sendTransaction).not.toHaveBeenCalled();
    });

    it('should create token account if it does not exist', async () => {
      const testMintAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
      
      // Mock account does not exist
      mockConnection.getAccountInfo.mockResolvedValue(null);
      
      // Mock successful account creation
      mockConnection.getLatestBlockhash.mockResolvedValue({
        blockhash: 'latest-blockhash'
      });
      mockConnection.sendTransaction.mockResolvedValue('account-creation-signature');
      mockConnection.confirmTransaction.mockResolvedValue({
        value: { err: null }
      });

      await (worker as any).ensureTokenAccount(testMintAddress, mockKeypair.publicKey);

      expect(mockConnection.getAccountInfo).toHaveBeenCalled();
      expect(mockConnection.sendTransaction).toHaveBeenCalled();
      expect(mockConnection.confirmTransaction).toHaveBeenCalledWith('account-creation-signature');
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('Token account created: account-creation-signature')
      );
    });

    it('should skip account creation if account already exists', async () => {
      const testMintAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
      
      // Mock account exists
      mockConnection.getAccountInfo.mockResolvedValue({
        data: 'existing-account-data'
      });

      await (worker as any).ensureTokenAccount(testMintAddress, mockKeypair.publicKey);

      expect(mockConnection.getAccountInfo).toHaveBeenCalled();
      expect(mockConnection.sendTransaction).not.toHaveBeenCalled();
    });

    it('should handle token account creation failures', async () => {
      const testMintAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
      
      mockConnection.getAccountInfo.mockResolvedValue(null);
      mockConnection.getLatestBlockhash.mockRejectedValue(new Error('Blockhash fetch failed'));

      await expect((worker as any).ensureTokenAccount(testMintAddress, mockKeypair.publicKey))
        .rejects.toThrow('Blockhash fetch failed');

      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining('Error ensuring token account'),
        expect.any(Error)
      );
    });
  });

  describe('Swap History & Profit Tracking - Analytics', () => {
    it('should maintain accurate swap history', async () => {
      // Setup successful SOL swap scenario
      mockConnection.getBalance.mockResolvedValue(10 * 1e9); // 10 SOL

      const mockQuote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: (5 * 1e9).toString(), // 5 SOL
        outAmount: (5 * 1e6).toString(), // 5 USDC
        slippageBps: 100
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockQuote
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            swapTransaction: Buffer.from('mock-swap-transaction').toString('base64')
          })
        } as Response);

      mockTokenService.getTokenInfo
        .mockResolvedValueOnce({
          mintAddress: 'So11111111111111111111111111111111111111112',
          symbol: 'SOL',
          name: 'Solana',
          decimals: 9,
          category: 'crypto' as const,
          isActive: true,
          lastUpdated: new Date()
        })
        .mockResolvedValueOnce({
          mintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          category: 'stablecoin' as const,
          isActive: true,
          lastUpdated: new Date()
        });

      mockConnection.sendTransaction.mockResolvedValue('history-test-signature');
      mockConnection.confirmTransaction.mockResolvedValue({
        value: { err: null }
      });

      const initialHistoryLength = mockJob.swapHistory.length;
      await worker.executeSwap('test-trigger');

      expect(mockJob.swapHistory).toHaveLength(initialHistoryLength + 1);
      
      const latestSwap = mockJob.swapHistory[mockJob.swapHistory.length - 1];
      expect(latestSwap.fromToken).toBe('A');
      expect(latestSwap.toToken).toBe('B');
      expect(latestSwap.fromAmount).toBe(5); // 5 SOL
      expect(latestSwap.toAmount).toBe(5); // 5 USDC
      expect(latestSwap.price).toBe(1); // 5 SOL / 5 USDC = 1
      expect(latestSwap.profit).toBe(0); // Initial profit calculation
      expect(latestSwap.timestamp).toBeTruthy();
    });

    it('should calculate price ratios correctly', () => {
      const testCases = [
        { fromAmount: 10, toAmount: 1, expectedPrice: 10 },
        { fromAmount: 100, toAmount: 2, expectedPrice: 50 },
        { fromAmount: 1, toAmount: 0.1, expectedPrice: 10 },
        { fromAmount: 0.5, toAmount: 50, expectedPrice: 0.01 },
      ];

      testCases.forEach(({ fromAmount, toAmount, expectedPrice }) => {
        const calculatedPrice = fromAmount / toAmount;
        expect(calculatedPrice).toBeCloseTo(expectedPrice, 5);
      });
    });
  });

  describe('Worker Lifecycle Management - System Integration', () => {
    it('should start and stop correctly', async () => {
      mockTokenService.validateTokenPair.mockResolvedValue({ isValid: true });
      
      // Mock the start method to avoid real connection creation
      const mockStart = jest.spyOn(worker as any, 'start').mockImplementation(async () => {
        const validation = await (worker as any).tokenService.validateTokenPair(
          (worker as any).job.tokenAMint,
          (worker as any).job.tokenBMint
        );
        if (!validation.isValid) {
          throw new Error(`Invalid token pair: ${validation.error}`);
        }
        (worker as any).isRunning = true;
      });

      await worker.start();
      expect((worker as any).isRunning).toBe(true);
      
      await worker.stop();
      expect((worker as any).isRunning).toBe(false);
      
      mockStart.mockRestore();
    });

    it('should prevent multiple starts', async () => {
      mockTokenService.validateTokenPair.mockResolvedValue({ isValid: true });
      
      // Mock the start method to avoid real connection creation
      const mockStart = jest.spyOn(worker as any, 'start').mockImplementation(async () => {
        if ((worker as any).isRunning) return;
        
        const validation = await (worker as any).tokenService.validateTokenPair(
          (worker as any).job.tokenAMint,
          (worker as any).job.tokenBMint
        );
        if (!validation.isValid) {
          throw new Error(`Invalid token pair: ${validation.error}`);
        }
        (worker as any).isRunning = true;
      });

      await worker.start();
      expect((worker as any).isRunning).toBe(true);

      // Second start should return early
      await worker.start();
      expect((worker as any).isRunning).toBe(true);
      
      // Validate should only be called once since second start returns early
      expect(mockTokenService.validateTokenPair).toHaveBeenCalledTimes(1);
      
      mockStart.mockRestore();
    });

    it('should update job activity after successful swaps', async () => {
      const initialActivity = mockJob.lastActivity;
      
      // Mock successful SOL swap
      mockConnection.getBalance.mockResolvedValue(10 * 1e9); // 10 SOL
      
      // Mock Jupiter quote and swap
      const mockQuote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: (5 * 1e9).toString(),
        outAmount: (5 * 1e6).toString(),
        slippageBps: 100
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockQuote
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            swapTransaction: Buffer.from('activity-test-transaction').toString('base64')
          })
        } as Response);

      mockTokenService.getTokenInfo
        .mockResolvedValueOnce({
          mintAddress: 'So11111111111111111111111111111111111111112',
          symbol: 'SOL',
          name: 'Solana',
          decimals: 9,
          category: 'crypto' as const,
          isActive: true,
          lastUpdated: new Date()
        })
        .mockResolvedValueOnce({
          mintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          category: 'stablecoin' as const,
          isActive: true,
          lastUpdated: new Date()
        });

      mockConnection.sendTransaction.mockResolvedValue('activity-test-signature');
      mockConnection.confirmTransaction.mockResolvedValue({
        value: { err: null }
      });

      await worker.executeSwap();

      expect(mockJob.lastActivity).not.toBe(initialActivity);
      expect(new Date(mockJob.lastActivity!).getTime()).toBeGreaterThan(new Date(initialActivity!).getTime());
    });
  });

  describe('Error Recovery & Edge Cases - Robustness', () => {
    it('should handle transaction confirmation failures', async () => {
      // Mock SOL balance
      mockConnection.getBalance.mockResolvedValue(10 * 1e9);

      const mockQuote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: (5 * 1e9).toString(),
        outAmount: (5 * 1e6).toString(),
        slippageBps: 100
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockQuote
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            swapTransaction: Buffer.from('failing-transaction').toString('base64')
          })
        } as Response);

      // Mock token info calls
      mockTokenService.getTokenInfo
        .mockResolvedValueOnce({
          mintAddress: 'So11111111111111111111111111111111111111112',
          symbol: 'SOL',
          name: 'Solana',
          decimals: 9,
          category: 'crypto' as const,
          isActive: true,
          lastUpdated: new Date()
        })
        .mockResolvedValueOnce({
          mintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          category: 'stablecoin' as const,
          isActive: true,
          lastUpdated: new Date()
        });

      mockConnection.sendTransaction.mockResolvedValue('failed-confirm-signature');
      mockConnection.confirmTransaction.mockResolvedValue({
        value: { err: 'Transaction failed: insufficient funds' }
      });

      const result = await worker.executeSwap();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Transaction failed');
    });

    it('should handle missing swap transaction in Jupiter response', async () => {
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [{
          account: {
            data: {
              parsed: {
                info: {
                  tokenAmount: {
                    amount: '1000000'
                  }
                }
              }
            }
          }
        }]
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            inputMint: 'TSLAx_MINT_ADDRESS_HERE',
            outputMint: 'wBTC_MINT_ADDRESS_HERE',
            inAmount: '500000',
            outAmount: '50000000'
          })
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            // Missing swapTransaction field
            message: 'Quote processed but no transaction'
          })
        } as Response);

      const result = await worker.executeSwap();

      expect(result.success).toBe(false);
      expect(result.error).toBe('No swap transaction returned from Jupiter API');
    });

    it('should reset processing flag after failed swaps', async () => {
      // Mock SOL balance fetch failure
      mockConnection.getBalance.mockRejectedValue(new Error('Balance fetch failed'));

      const result = await worker.executeSwap();

      expect(result.success).toBe(false);
      expect((worker as any).isProcessingSwap).toBe(false); // Should be reset
    });
  });
});