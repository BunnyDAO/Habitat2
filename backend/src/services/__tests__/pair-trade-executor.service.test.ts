import { PairTradeExecutor } from '../pair-trade-executor.service';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

describe('PairTradeExecutor', () => {
  let executor: PairTradeExecutor;
  let mockConnection: jest.Mocked<Connection>;

  beforeEach(() => {
    mockConnection = {
      getBalance: jest.fn(),
    } as any;
    
    executor = new PairTradeExecutor(mockConnection);
  });

  describe('executeInitialAllocation', () => {
    it('should calculate correct SOL amount from percentage', async () => {
      const walletBalance = 10 * LAMPORTS_PER_SOL; // 10 SOL
      mockConnection.getBalance.mockResolvedValue(walletBalance);

      const mockJupiterSwap = jest.spyOn(executor as any, 'executeJupiterSwap').mockResolvedValue({
        signature: 'mock_signature',
        inputAmount: 5 * LAMPORTS_PER_SOL,
        outputAmount: 500 * 1000000, // 500 USDC (6 decimals)
      });

      const result = await executor.executeInitialAllocation({
        walletPubkey: 'wallet_address',
        tokenAMint: 'SOL',
        tokenBMint: 'USDC',
        allocationPercentage: 50,
        recommendedToken: 'B' // Buy USDC
      });

      expect(mockConnection.getBalance).toHaveBeenCalledWith(expect.any(PublicKey));
      expect(mockJupiterSwap).toHaveBeenCalledWith({
        inputMint: 'SOL',
        outputMint: 'USDC',
        amount: 5 * LAMPORTS_PER_SOL,
        walletPubkey: 'wallet_address'
      });
      
      expect(result.allocatedAmount).toBe(5 * LAMPORTS_PER_SOL);
      expect(result.purchasedToken).toBe('B');
      expect(result.purchasedAmount).toBe(500 * 1000000);
    });

    it('should swap to undervalued token as determined by valuation', async () => {
      const walletBalance = 10 * LAMPORTS_PER_SOL;
      mockConnection.getBalance.mockResolvedValue(walletBalance);

      const mockJupiterSwap = jest.spyOn(executor as any, 'executeJupiterSwap').mockResolvedValue({
        signature: 'mock_signature',
        inputAmount: 3 * LAMPORTS_PER_SOL,
        outputAmount: 100 * 1000000, // Some token amount
      });

      // Test when Token A is recommended
      await executor.executeInitialAllocation({
        walletPubkey: 'wallet_address',
        tokenAMint: 'USDC',
        tokenBMint: 'SOL', 
        allocationPercentage: 30,
        recommendedToken: 'A' // Buy USDC (Token A)
      });

      expect(mockJupiterSwap).toHaveBeenCalledWith({
        inputMint: 'SOL', // Always start with SOL
        outputMint: 'USDC', // Buy the recommended token
        amount: 3 * LAMPORTS_PER_SOL,
        walletPubkey: 'wallet_address'
      });
    });

    it('should handle insufficient wallet balance gracefully', async () => {
      const walletBalance = 1 * LAMPORTS_PER_SOL; // Only 1 SOL
      mockConnection.getBalance.mockResolvedValue(walletBalance);

      await expect(executor.executeInitialAllocation({
        walletPubkey: 'wallet_address',
        tokenAMint: 'SOL',
        tokenBMint: 'USDC',
        allocationPercentage: 200, // 200% - impossible
        recommendedToken: 'B'
      })).rejects.toThrow('Insufficient wallet balance');
    });

    it('should update strategy holdings after successful swap', async () => {
      const walletBalance = 10 * LAMPORTS_PER_SOL;
      mockConnection.getBalance.mockResolvedValue(walletBalance);

      const mockJupiterSwap = jest.spyOn(executor as any, 'executeJupiterSwap').mockResolvedValue({
        signature: 'mock_signature',
        inputAmount: 5 * LAMPORTS_PER_SOL,
        outputAmount: 500 * 1000000,
      });

      const mockUpdateHoldings = jest.spyOn(executor as any, 'updateStrategyHoldings').mockResolvedValue(undefined);

      await executor.executeInitialAllocation({
        walletPubkey: 'wallet_address',
        tokenAMint: 'SOL',
        tokenBMint: 'USDC',
        allocationPercentage: 50,
        recommendedToken: 'B',
        strategyId: 'strategy_123'
      });

      expect(mockUpdateHoldings).toHaveBeenCalledWith('strategy_123', {
        tokenA: { mint: 'SOL', amount: 0 },
        tokenB: { mint: 'USDC', amount: 500 * 1000000 },
        totalAllocatedSOL: 5 * LAMPORTS_PER_SOL
      });
    });

    it('should rollback on swap failure', async () => {
      const walletBalance = 10 * LAMPORTS_PER_SOL;
      mockConnection.getBalance.mockResolvedValue(walletBalance);

      jest.spyOn(executor as any, 'executeJupiterSwap').mockRejectedValue(new Error('Swap failed'));

      await expect(executor.executeInitialAllocation({
        walletPubkey: 'wallet_address',
        tokenAMint: 'SOL',
        tokenBMint: 'USDC',
        allocationPercentage: 50,
        recommendedToken: 'B'
      })).rejects.toThrow('Failed to execute initial allocation');
    });
  });

  describe('executeSignalTrade', () => {
    it('should swap from tokenA to tokenB when signal says sell A', async () => {
      const mockGetHoldings = jest.spyOn(executor as any, 'getStrategyHoldings').mockResolvedValue({
        tokenA: { mint: 'USDC', amount: 500 * 1000000 },
        tokenB: { mint: 'SOL', amount: 0 },
        totalAllocatedSOL: 5 * LAMPORTS_PER_SOL
      });

      const mockJupiterSwap = jest.spyOn(executor as any, 'executeJupiterSwap').mockResolvedValue({
        signature: 'mock_signature',
        inputAmount: 500 * 1000000,
        outputAmount: 4.8 * LAMPORTS_PER_SOL, // After slippage
      });

      const result = await executor.executeSignalTrade({
        strategyId: 'strategy_123',
        action: 'sell',
        targetToken: 'A', // Sell Token A (USDC)
        percentage: 100 // Sell all
      });

      expect(mockJupiterSwap).toHaveBeenCalledWith({
        inputMint: 'USDC',
        outputMint: 'SOL',
        amount: 500 * 1000000,
        walletPubkey: expect.any(String)
      });

      expect(result.success).toBe(true);
      expect(result.fromToken).toBe('A');
      expect(result.toToken).toBe('B');
    });

    it('should swap from tokenB to tokenA when signal says sell B', async () => {
      const mockGetHoldings = jest.spyOn(executor as any, 'getStrategyHoldings').mockResolvedValue({
        tokenA: { mint: 'USDC', amount: 0 },
        tokenB: { mint: 'SOL', amount: 5 * LAMPORTS_PER_SOL },
        totalAllocatedSOL: 5 * LAMPORTS_PER_SOL
      });

      const mockJupiterSwap = jest.spyOn(executor as any, 'executeJupiterSwap').mockResolvedValue({
        signature: 'mock_signature',
        inputAmount: 2.5 * LAMPORTS_PER_SOL,
        outputAmount: 250 * 1000000,
      });

      await executor.executeSignalTrade({
        strategyId: 'strategy_123',
        action: 'sell',
        targetToken: 'B', // Sell Token B (SOL)
        percentage: 50 // Sell half
      });

      expect(mockJupiterSwap).toHaveBeenCalledWith({
        inputMint: 'SOL',
        outputMint: 'USDC',
        amount: 2.5 * LAMPORTS_PER_SOL,
        walletPubkey: expect.any(String)
      });
    });

    it('should respect slippage limits', async () => {
      const mockJupiterSwap = jest.spyOn(executor as any, 'executeJupiterSwap');
      
      await executor.executeSignalTrade({
        strategyId: 'strategy_123',
        action: 'sell',
        targetToken: 'A',
        percentage: 100,
        maxSlippage: 2.5 // 2.5% max slippage
      });

      expect(mockJupiterSwap).toHaveBeenCalledWith(expect.objectContaining({
        slippageBps: 250 // 2.5% in basis points
      }));
    });

    it('should handle partial fills correctly', async () => {
      const mockGetHoldings = jest.spyOn(executor as any, 'getStrategyHoldings').mockResolvedValue({
        tokenA: { mint: 'USDC', amount: 1000 * 1000000 },
        tokenB: { mint: 'SOL', amount: 0 },
        totalAllocatedSOL: 10 * LAMPORTS_PER_SOL
      });

      // Mock partial fill - only 80% of trade executes
      const mockJupiterSwap = jest.spyOn(executor as any, 'executeJupiterSwap').mockResolvedValue({
        signature: 'mock_signature',
        inputAmount: 400 * 1000000, // Only 400 instead of 500
        outputAmount: 3.8 * LAMPORTS_PER_SOL,
      });

      const result = await executor.executeSignalTrade({
        strategyId: 'strategy_123',
        action: 'sell',
        targetToken: 'A',
        percentage: 50 // Intend to sell 50% (500 USDC)
      });

      expect(result.actualPercentage).toBe(40); // Actually sold 40% due to partial fill
      expect(result.partialFill).toBe(true);
    });

    it('should not exceed original allocation percentage', async () => {
      // This test ensures we can't trade more than the original allocated amount
      const mockGetHoldings = jest.spyOn(executor as any, 'getStrategyHoldings').mockResolvedValue({
        tokenA: { mint: 'USDC', amount: 0 },
        tokenB: { mint: 'SOL', amount: 3 * LAMPORTS_PER_SOL },
        totalAllocatedSOL: 5 * LAMPORTS_PER_SOL
      });

      // The holdings show we only have 3 SOL but originally allocated 5 SOL
      // This prevents us from buying more than the original allocation
      
      const result = await executor.executeSignalTrade({
        strategyId: 'strategy_123',
        action: 'sell',
        targetToken: 'B',
        percentage: 100
      });

      // Should only trade the actual holdings, not exceed original allocation
      expect(result.maxTradeableAmount).toBe(3 * LAMPORTS_PER_SOL);
    });
  });
});