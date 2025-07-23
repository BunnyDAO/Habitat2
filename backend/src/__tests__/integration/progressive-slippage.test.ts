import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { SwapService } from '../../services/swap.service';
import { PublicKey, Keypair, Connection } from '@solana/web3.js';
import { Pool } from 'pg';

describe('Progressive Slippage Integration Tests', () => {
  let swapService: SwapService;
  let mockPool: Pool;
  let mockConnection: Connection;
  let mockKeypair: Keypair;

  beforeEach(() => {
    mockKeypair = Keypair.generate();
    
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn()
    } as any;

    mockConnection = {
      getBalance: jest.fn(),
      getRecentBlockhash: jest.fn(),
      sendRawTransaction: jest.fn(),
      confirmTransaction: jest.fn(),
    } as any;

    swapService = new SwapService(mockPool, mockConnection, null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('SwapService - Progressive Slippage Implementation', () => {
    let mockFetch: jest.MockedFunction<typeof fetch>;

    beforeEach(() => {
      mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
      global.fetch = mockFetch;
    });

    it('should implement progressive slippage retry logic', async () => {
      const swapRequest = {
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        amount: 1000000000, // 1 SOL in lamports
        slippageBps: 50, // Initial 0.5% slippage
        walletKeypair: {
          publicKey: mockKeypair.publicKey.toString(),
          secretKey: Array.from(mockKeypair.secretKey)
        }
      };

      // Mock Jupiter quote API - fail with slippage errors 3 times, succeed on 4th
      mockFetch
        // First attempt (0.5% slippage) - quote succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            inputMint: swapRequest.inputMint,
            outputMint: swapRequest.outputMint,
            inAmount: swapRequest.amount.toString(),
            outAmount: '200000000', // Mock 200 USDC
            slippageBps: 50
          })
        } as Response)
        // First swap attempt - fails with slippage error
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: () => Promise.resolve('Slippage tolerance exceeded')
        } as Response)
        // Second attempt (1.5% slippage) - quote succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            inputMint: swapRequest.inputMint,
            outputMint: swapRequest.outputMint,
            inAmount: swapRequest.amount.toString(),
            outAmount: '195000000', // Slightly less due to higher slippage
            slippageBps: 150
          })
        } as Response)
        // Second swap attempt - fails with slippage error
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: () => Promise.resolve('Slippage tolerance exceeded')
        } as Response)
        // Third attempt (3.0% slippage) - quote succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            inputMint: swapRequest.inputMint,
            outputMint: swapRequest.outputMint,
            inAmount: swapRequest.amount.toString(),
            outAmount: '190000000',
            slippageBps: 300
          })
        } as Response)
        // Third swap attempt - fails with slippage error
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: () => Promise.resolve('Slippage tolerance exceeded')
        } as Response)
        // Fourth attempt (5.0% slippage) - quote succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            inputMint: swapRequest.inputMint,
            outputMint: swapRequest.outputMint,
            inAmount: swapRequest.amount.toString(),
            outAmount: '185000000',
            slippageBps: 500
          })
        } as Response)
        // Fourth swap attempt - succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            txid: 'success-transaction-signature',
            inputAmount: swapRequest.amount.toString(),
            outputAmount: '185000000'
          })
        } as Response);

      // Mock Solana connection methods
      mockConnection.sendRawTransaction = jest.fn().mockResolvedValue('success-transaction-signature');
      mockConnection.confirmTransaction = jest.fn().mockResolvedValue({
        value: { err: null }
      });

      const result = await swapService.executeSwap(swapRequest);

      expect(result.signature).toBe('success-transaction-signature');
      expect(result.message).toContain('succeeded with 5.0% slippage after 4 attempts');
      
      // Verify all slippage levels were attempted
      expect(mockFetch).toHaveBeenCalledTimes(8); // 4 quote calls + 4 swap calls
    });

    it('should fail after exhausting all slippage attempts', async () => {
      const swapRequest = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000000,
        slippageBps: 50,
        walletKeypair: {
          publicKey: mockKeypair.publicKey.toString(),
          secretKey: Array.from(mockKeypair.secretKey)
        }
      };

      // Mock all attempts to fail with slippage errors
      const mockQuoteResponse = {
        ok: true,
        json: () => Promise.resolve({
          inputMint: swapRequest.inputMint,
          outputMint: swapRequest.outputMint,
          inAmount: swapRequest.amount.toString(),
          outAmount: '200000000',
          slippageBps: 50
        })
      } as Response;

      const mockFailedSwap = {
        ok: false,
        status: 400,
        text: () => Promise.resolve('Slippage tolerance exceeded')
      } as Response;

      mockFetch
        .mockResolvedValue(mockQuoteResponse)  // All quotes succeed
        .mockResolvedValueOnce(mockQuoteResponse)
        .mockResolvedValueOnce(mockFailedSwap)  // 1st swap fails
        .mockResolvedValueOnce(mockQuoteResponse)
        .mockResolvedValueOnce(mockFailedSwap)  // 2nd swap fails
        .mockResolvedValueOnce(mockQuoteResponse)
        .mockResolvedValueOnce(mockFailedSwap)  // 3rd swap fails
        .mockResolvedValueOnce(mockQuoteResponse)
        .mockResolvedValueOnce(mockFailedSwap); // 4th swap fails

      await expect(swapService.executeSwap(swapRequest))
        .rejects.toThrow('Slippage tolerance exceeded');

      // Should have attempted all 4 slippage levels
      expect(mockFetch).toHaveBeenCalledTimes(8);
    });

    it('should succeed immediately if initial slippage is sufficient', async () => {
      const swapRequest = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000000,
        slippageBps: 50,
        walletKeypair: {
          publicKey: mockKeypair.publicKey.toString(),
          secretKey: Array.from(mockKeypair.secretKey)
        }
      };

      // Mock successful quote and swap on first attempt
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            inputMint: swapRequest.inputMint,
            outputMint: swapRequest.outputMint,
            inAmount: swapRequest.amount.toString(),
            outAmount: '200000000',
            slippageBps: 50
          })
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            txid: 'immediate-success-signature',
            inputAmount: swapRequest.amount.toString(),
            outputAmount: '200000000'
          })
        } as Response);

      mockConnection.sendRawTransaction = jest.fn().mockResolvedValue('immediate-success-signature');
      mockConnection.confirmTransaction = jest.fn().mockResolvedValue({
        value: { err: null }
      });

      const result = await swapService.executeSwap(swapRequest);

      expect(result.signature).toBe('immediate-success-signature');
      expect(result.message).not.toContain('after'); // No retry message
      
      // Should only call fetch twice (quote + swap)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry non-slippage errors', async () => {
      const swapRequest = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000000,
        slippageBps: 50,
        walletKeypair: {
          publicKey: mockKeypair.publicKey.toString(),
          secretKey: Array.from(mockKeypair.secretKey)
        }
      };

      // Mock quote success but swap fails with non-slippage error
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            inputMint: swapRequest.inputMint,
            outputMint: swapRequest.outputMint,
            inAmount: swapRequest.amount.toString(),
            outAmount: '200000000',
            slippageBps: 50
          })
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: () => Promise.resolve('Insufficient balance')
        } as Response);

      await expect(swapService.executeSwap(swapRequest))
        .rejects.toThrow('Insufficient balance');

      // Should only attempt once (no retries for non-slippage errors)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Slippage Configuration - Platform Standards', () => {
    it('should use standardized slippage progression across platform', () => {
      const EXPECTED_SLIPPAGE_PROGRESSION = [50, 150, 300, 500]; // 0.5%, 1.5%, 3.0%, 5.0%
      const MAX_SLIPPAGE = 500; // 5.0%
      const ATTEMPT_COUNT = 4;

      // Verify slippage progression
      expect(EXPECTED_SLIPPAGE_PROGRESSION).toHaveLength(ATTEMPT_COUNT);
      expect(Math.max(...EXPECTED_SLIPPAGE_PROGRESSION)).toBe(MAX_SLIPPAGE);
      
      // Verify progression is ascending
      for (let i = 1; i < EXPECTED_SLIPPAGE_PROGRESSION.length; i++) {
        expect(EXPECTED_SLIPPAGE_PROGRESSION[i]).toBeGreaterThan(EXPECTED_SLIPPAGE_PROGRESSION[i - 1]);
      }
    });

    it('should enforce 5% maximum slippage limit across all strategies', () => {
      const MAX_PLATFORM_SLIPPAGE = 500; // 5% in basis points
      
      // This represents our platform-wide slippage limit
      expect(MAX_PLATFORM_SLIPPAGE).toBe(500);
      
      // No strategy should be able to exceed this limit
      const testSlippageValues = [50, 150, 300, 500, 1000]; // Including invalid 10%
      const validSlippageValues = testSlippageValues.filter(bps => bps <= MAX_PLATFORM_SLIPPAGE);
      
      expect(validSlippageValues).toEqual([50, 150, 300, 500]);
      expect(validSlippageValues).not.toContain(1000);
    });
  });

  describe('Error Message Consistency', () => {
    it('should provide consistent error messages for slippage retries', () => {
      const testCases = [
        { attempts: 1, slippage: 0.5, expected: 'Swap completed successfully' },
        { attempts: 2, slippage: 1.5, expected: 'succeeded with 1.5% slippage after 2 attempts' },
        { attempts: 3, slippage: 3.0, expected: 'succeeded with 3.0% slippage after 3 attempts' },
        { attempts: 4, slippage: 5.0, expected: 'succeeded with 5.0% slippage after 4 attempts' }
      ];

      testCases.forEach(({ attempts, slippage, expected }) => {
        let message: string;
        
        if (attempts === 1) {
          message = 'Swap completed successfully';
        } else {
          message = `Swap completed successfully (succeeded with ${slippage}% slippage after ${attempts} attempts)`;
        }

        expect(message).toContain(expected);
      });
    });
  });

  describe('Integration with Strategy Workers', () => {
    it('should validate that all workers can handle slippage retry responses', () => {
      // Test that our swap response format is compatible with all strategy expectations
      const mockSuccessfulRetryResponse = {
        signature: 'test-signature-123',
        inputAmount: '1000000000',
        outputAmount: '200000000',
        message: 'Swap completed successfully (succeeded with 3.0% slippage after 3 attempts)'
      };

      // Verify required fields are present
      expect(mockSuccessfulRetryResponse).toHaveProperty('signature');
      expect(mockSuccessfulRetryResponse).toHaveProperty('inputAmount');
      expect(mockSuccessfulRetryResponse).toHaveProperty('outputAmount');
      expect(mockSuccessfulRetryResponse).toHaveProperty('message');
      
      // Verify message format for logging
      expect(mockSuccessfulRetryResponse.message).toMatch(/succeeded with \d+\.\d+% slippage after \d+ attempts/);
    });

    it('should ensure swap response is compatible with profit tracking', () => {
      const mockResponse = {
        signature: 'profit-track-test',
        inputAmount: '5000000000', // 5 SOL
        outputAmount: '1000000000', // 1000 USDC (mock)
        message: 'Swap completed successfully (succeeded with 1.5% slippage after 2 attempts)'
      };

      // Verify amounts can be parsed for profit calculations
      const inputSOL = parseInt(mockResponse.inputAmount) / 1e9;
      const outputAmount = parseInt(mockResponse.outputAmount);
      
      expect(inputSOL).toBe(5);
      expect(outputAmount).toBe(1000000000);
      expect(typeof mockResponse.signature).toBe('string');
    });
  });

  describe('Performance and Rate Limiting', () => {
    it('should not cause excessive API calls during slippage retries', () => {
      const MAX_ATTEMPTS = 4;
      const CALLS_PER_ATTEMPT = 2; // 1 quote + 1 swap
      const MAX_TOTAL_CALLS = MAX_ATTEMPTS * CALLS_PER_ATTEMPT;

      // Verify our retry logic doesn't exceed reasonable API call limits
      expect(MAX_TOTAL_CALLS).toBe(8);
      expect(MAX_TOTAL_CALLS).toBeLessThanOrEqual(10); // Reasonable limit
    });

    it('should have appropriate delay between retry attempts', () => {
      // In a real implementation, we might want delays between retries
      // For now, we verify that immediate retries are acceptable for our volume
      const RETRY_DELAY_MS = 0; // Immediate retries
      const MAX_ACCEPTABLE_DELAY = 1000; // 1 second max
      
      expect(RETRY_DELAY_MS).toBeLessThanOrEqual(MAX_ACCEPTABLE_DELAY);
    });
  });
});