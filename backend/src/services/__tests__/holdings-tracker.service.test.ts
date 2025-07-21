import { HoldingsTracker } from '../holdings-tracker.service';
import { Pool } from 'pg';

describe('HoldingsTracker', () => {
  let holdingsTracker: HoldingsTracker;
  let mockPool: jest.Mocked<Pool>;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
    } as any;
    
    holdingsTracker = new HoldingsTracker(mockPool);
  });

  describe('updateHoldings', () => {
    it('should create new holdings record for strategy', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // SELECT - no existing record
        .mockResolvedValueOnce({ rows: [{ id: 'holding_id' }] }); // INSERT

      const holdings = {
        tokenA: { mint: 'So11111111111111111111111111111111111111112', amount: 1000000000 },
        tokenB: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: 500000000 },
        totalAllocatedSOL: 5000000000
      };

      await holdingsTracker.updateHoldings('strategy_123', holdings);

      expect(mockPool.query).toHaveBeenCalledTimes(2);
      expect(mockPool.query).toHaveBeenNthCalledWith(2, 
        expect.stringContaining('INSERT INTO strategy_holdings'),
        expect.arrayContaining(['strategy_123', 'SOL', 1000000000, 'USDC', 500000000, 5000000000])
      );
    });

    it('should update existing holdings record', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 'existing_id' }] }) // SELECT - existing record
        .mockResolvedValueOnce({ rows: [{ id: 'existing_id' }] }); // UPDATE

      const holdings = {
        tokenA: { mint: 'SOL', amount: 2000000000 },
        tokenB: { mint: 'USDC', amount: 250000000 },
        totalAllocatedSOL: 5000000000
      };

      await holdingsTracker.updateHoldings('strategy_123', holdings);

      expect(mockPool.query).toHaveBeenCalledTimes(2);
      expect(mockPool.query).toHaveBeenNthCalledWith(2,
        expect.stringContaining('UPDATE strategy_holdings'),
        expect.arrayContaining([2000000000, 250000000, 'existing_id'])
      );
    });

    it('should handle database errors gracefully', async () => {
      mockPool.query.mockRejectedValue(new Error('Database connection failed'));

      const holdings = {
        tokenA: { mint: 'So11111111111111111111111111111111111111112', amount: 1000000000 },
        tokenB: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: 500000000 },
        totalAllocatedSOL: 5000000000
      };

      await expect(holdingsTracker.updateHoldings('strategy_123', holdings))
        .rejects.toThrow('Failed to update holdings');
    });
  });

  describe('getHoldings', () => {
    it('should retrieve holdings for strategy', async () => {
      const mockRow = {
        token_a_mint: 'So11111111111111111111111111111111111111112',
        token_a_amount: '1000000000',
        token_b_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 
        token_b_amount: '500000000',
        total_allocated_sol: '5000000000',
        last_updated: new Date()
      };

      mockPool.query.mockResolvedValue({ rows: [mockRow] });

      const result = await holdingsTracker.getHoldings('strategy_123');

      expect(result).toEqual({
        tokenA: { mint: 'So11111111111111111111111111111111111111112', amount: 1000000000 },
        tokenB: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: 500000000 },
        totalAllocatedSOL: 5000000000,
        lastUpdated: mockRow.last_updated
      });
    });

    it('should return null when no holdings exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await holdingsTracker.getHoldings('strategy_123');

      expect(result).toBeNull();
    });

    it('should handle invalid strategy id', async () => {
      await expect(holdingsTracker.getHoldings(''))
        .rejects.toThrow('Invalid strategy ID');
    });
  });

  describe('getTradeHistory', () => {
    it('should retrieve trade history for strategy', async () => {
      const mockTrades = [
        {
          id: 'trade_1',
          trade_type: 'initial_allocation',
          from_mint: 'SOL',
          to_mint: 'USDC',
          input_amount: '1000000000',
          output_amount: '100000000',
          percentage_traded: '50.00',
          jupiter_signature: 'sig_1',
          execution_status: 'completed',
          created_at: new Date()
        },
        {
          id: 'trade_2', 
          trade_type: 'signal_trade',
          from_mint: 'USDC',
          to_mint: 'SOL',
          input_amount: '50000000',
          output_amount: '500000000',
          percentage_traded: '25.00',
          jupiter_signature: 'sig_2',
          execution_status: 'completed',
          created_at: new Date()
        }
      ];

      mockPool.query.mockResolvedValue({ rows: mockTrades });

      const result = await holdingsTracker.getTradeHistory('strategy_123');

      expect(result).toHaveLength(2);
      expect(result[0].tradeType).toBe('initial_allocation');
      expect(result[1].tradeType).toBe('signal_trade');
    });

    it('should return empty array when no trades exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await holdingsTracker.getTradeHistory('strategy_123');

      expect(result).toEqual([]);
    });

    it('should support pagination', async () => {
      const mockTrades = Array.from({ length: 10 }, (_, i) => ({
        id: `trade_${i}`,
        trade_type: 'signal_trade',
        created_at: new Date()
      }));

      mockPool.query.mockResolvedValue({ rows: mockTrades.slice(0, 5) });

      const result = await holdingsTracker.getTradeHistory('strategy_123', 5, 0);

      expect(result).toHaveLength(5);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2 OFFSET $3'),
        expect.arrayContaining(['strategy_123', 5, 0])
      );
    });
  });

  describe('recordTrade', () => {
    it('should record successful trade', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'trade_id' }] });

      const tradeData = {
        strategyId: 'strategy_123',
        tradeType: 'signal_trade' as const,
        fromToken: 'A' as const,
        toToken: 'B' as const,
        fromMint: 'So11111111111111111111111111111111111111112',
        toMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inputAmount: 1000000000,
        outputAmount: 100000000,
        percentageTraded: 50,
        jupiterSignature: 'mock_signature',
        executionStatus: 'completed' as const
      };

      await holdingsTracker.recordTrade(tradeData);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO trade_history'),
        expect.arrayContaining([
          'strategy_123',
          'signal_trade',
          'A',
          'B',
          'SOL',
          'USDC',
          1000000000,
          100000000,
          50,
          'mock_signature',
          'completed'
        ])
      );
    });

    it('should record failed trade with error message', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'trade_id' }] });

      const tradeData = {
        strategyId: 'strategy_123',
        tradeType: 'signal_trade' as const,
        fromToken: 'A' as const,
        toToken: 'B' as const,
        fromMint: 'So11111111111111111111111111111111111111112',
        toMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inputAmount: 1000000000,
        outputAmount: 0,
        percentageTraded: 0,
        executionStatus: 'failed' as const,
        errorMessage: 'Insufficient liquidity'
      };

      await holdingsTracker.recordTrade(tradeData);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO trade_history'),
        expect.arrayContaining(['Insufficient liquidity'])
      );
    });

    it('should include signal data when provided', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'trade_id' }] });

      const signalData = {
        tokenAMint: 'SOL',
        tokenBMint: 'USDC',
        action: 'sell',
        percentage: 50
      };

      const tradeData = {
        strategyId: 'strategy_123',
        tradeType: 'signal_trade' as const,
        fromToken: 'A' as const,
        toToken: 'B' as const,
        fromMint: 'So11111111111111111111111111111111111111112',
        toMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inputAmount: 1000000000,
        outputAmount: 100000000,
        percentageTraded: 50,
        executionStatus: 'completed' as const,
        signalData
      };

      await holdingsTracker.recordTrade(tradeData);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO trade_history'),
        expect.arrayContaining([JSON.stringify(signalData)])
      );
    });
  });

  describe('calculatePortfolioValue', () => {
    it('should calculate total portfolio value in USD', async () => {
      const holdings = {
        tokenA: { mint: 'So11111111111111111111111111111111111111112', amount: 1000000000 }, // 1 SOL
        tokenB: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: 500000000 }, // 500 USDC
        totalAllocatedSOL: 5000000000
      };

      // Mock price data
      const mockPrices = { SOL: 100, USDC: 1 };
      jest.spyOn(holdingsTracker as any, 'getTokenPrices').mockResolvedValue(mockPrices);

      const result = await holdingsTracker.calculatePortfolioValue(holdings);

      expect(result.totalValueUSD).toBe(600); // (1 * 100) + (500 * 1)
      expect(result.tokenAValueUSD).toBe(100);
      expect(result.tokenBValueUSD).toBe(500);
      expect(result.allocationUtilized).toBe(600 / 500); // Assuming 5 SOL = $500 initially
    });

    it('should handle missing price data gracefully', async () => {
      const holdings = {
        tokenA: { mint: 'SOL', amount: 1000000000 },
        tokenB: { mint: 'UNKNOWN_TOKEN', amount: 500000000 },
        totalAllocatedSOL: 5000000000
      };

      jest.spyOn(holdingsTracker as any, 'getTokenPrices').mockResolvedValue({ SOL: 100 });

      const result = await holdingsTracker.calculatePortfolioValue(holdings);

      expect(result.tokenAValueUSD).toBe(100);
      expect(result.tokenBValueUSD).toBe(0); // Unknown token price
      expect(result.totalValueUSD).toBe(100);
    });
  });
});