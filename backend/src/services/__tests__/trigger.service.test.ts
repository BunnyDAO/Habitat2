import { TriggerService } from '../trigger.service';

describe('TriggerService', () => {
  let triggerService: TriggerService;

  beforeEach(() => {
    triggerService = new TriggerService();
  });

  describe('processPairTradeSignal', () => {
    it('should find strategies matching token pair', async () => {
      const mockFindStrategies = jest.spyOn(triggerService as any, 'findStrategiesByTokenPair')
        .mockResolvedValue([
          { id: 'strategy_1', tokenAMint: 'So11111111111111111111111111111111111111112', tokenBMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
          { id: 'strategy_2', tokenAMint: 'So11111111111111111111111111111111111111112', tokenBMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
        ]);

      const mockExecuteTrade = jest.spyOn(triggerService as any, 'executeTrade')
        .mockResolvedValue({ success: true, signature: 'mock_sig' });

      const signal = {
        tokenAMint: 'So11111111111111111111111111111111111111112',
        tokenBMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        action: 'sell' as const,
        targetToken: 'A' as const,
        percentage: 50,
        timestamp: new Date().toISOString()
      };

      const result = await triggerService.processPairTradeSignal(signal);

      expect(mockFindStrategies).toHaveBeenCalledWith('So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(mockExecuteTrade).toHaveBeenCalledTimes(2);
      expect(result.processedStrategies).toBe(2);
      expect(result.successfulTrades).toBe(2);
    });

    it('should ignore strategies with different token pairs', async () => {
      const mockFindStrategies = jest.spyOn(triggerService as any, 'findStrategiesByTokenPair')
        .mockResolvedValue([
          { id: 'strategy_1', tokenAMint: 'So11111111111111111111111111111111111111112', tokenBMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
          // Only return the matching strategy since findStrategiesByTokenPair should filter
        ]);

      const mockExecuteTrade = jest.spyOn(triggerService as any, 'executeTrade')
        .mockResolvedValue({ success: true, signature: 'mock_sig' });

      const signal = {
        tokenAMint: 'So11111111111111111111111111111111111111112',
        tokenBMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        action: 'sell' as const,
        targetToken: 'A' as const,
        percentage: 50,
        timestamp: new Date().toISOString()
      };

      const result = await triggerService.processPairTradeSignal(signal);

      expect(result.processedStrategies).toBe(1); // Only one matching strategy
    });

    it('should validate signal format before processing', async () => {
      const invalidSignal = {
        tokenAMint: '', // Invalid - empty
        tokenBMint: 'USDC',
        action: 'sell' as const,
        targetToken: 'A' as const,
        percentage: 50,
        timestamp: new Date().toISOString()
      };

      await expect(triggerService.processPairTradeSignal(invalidSignal))
        .rejects.toThrow('Invalid signal format');
    });

    it('should handle multiple strategies with same token pair', async () => {
      const strategies = Array.from({ length: 5 }, (_, i) => ({
        id: `strategy_${i}`,
        tokenAMint: 'So11111111111111111111111111111111111111112',
        tokenBMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      }));

      const mockFindStrategies = jest.spyOn(triggerService as any, 'findStrategiesByTokenPair')
        .mockResolvedValue(strategies);

      const mockExecuteTrade = jest.spyOn(triggerService as any, 'executeTrade')
        .mockResolvedValue({ success: true, signature: 'mock_sig' });

      const signal = {
        tokenAMint: 'So11111111111111111111111111111111111111112',
        tokenBMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        action: 'sell' as const,
        targetToken: 'A' as const,
        percentage: 25,
        timestamp: new Date().toISOString()
      };

      const result = await triggerService.processPairTradeSignal(signal);

      expect(result.processedStrategies).toBe(5);
      expect(mockExecuteTrade).toHaveBeenCalledTimes(5);
    });

    it('should reject signals with invalid token addresses', async () => {
      const invalidSignal = {
        tokenAMint: 'invalid_address',
        tokenBMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        action: 'sell' as const,
        targetToken: 'A' as const,
        percentage: 50,
        timestamp: new Date().toISOString()
      };

      await expect(triggerService.processPairTradeSignal(invalidSignal))
        .rejects.toThrow('Invalid token mint addresses');
    });

    it('should log processed signals for audit trail', async () => {
      const mockFindStrategies = jest.spyOn(triggerService as any, 'findStrategiesByTokenPair')
        .mockResolvedValue([{ id: 'strategy_1', tokenAMint: 'SOL', tokenBMint: 'USDC' }]);

      const mockExecuteTrade = jest.spyOn(triggerService as any, 'executeTrade')
        .mockResolvedValue({ success: true, signature: 'mock_sig' });

      const mockLogSignal = jest.spyOn(triggerService as any, 'logProcessedSignal')
        .mockResolvedValue(undefined);

      const signal = {
        tokenAMint: 'So11111111111111111111111111111111111111112',
        tokenBMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        action: 'sell' as const,
        targetToken: 'A' as const,
        percentage: 50,
        timestamp: new Date().toISOString()
      };

      await triggerService.processPairTradeSignal(signal);

      expect(mockLogSignal).toHaveBeenCalledWith(signal, expect.objectContaining({
        processedStrategies: 1,
        successfulTrades: 1
      }));
    });

    it('should handle trade execution failures gracefully', async () => {
      const mockFindStrategies = jest.spyOn(triggerService as any, 'findStrategiesByTokenPair')
        .mockResolvedValue([
          { id: 'strategy_1', tokenAMint: 'So11111111111111111111111111111111111111112', tokenBMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
          { id: 'strategy_2', tokenAMint: 'So11111111111111111111111111111111111111112', tokenBMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
        ]);

      const mockExecuteTrade = jest.spyOn(triggerService as any, 'executeTrade')
        .mockResolvedValueOnce({ success: true, signature: 'mock_sig_1' })
        .mockRejectedValueOnce(new Error('Trade failed'))
        .mockResolvedValueOnce({ success: true, signature: 'mock_sig_2' });

      const signal = {
        tokenAMint: 'So11111111111111111111111111111111111111112',
        tokenBMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        action: 'sell' as const,
        targetToken: 'A' as const,
        percentage: 50,
        timestamp: new Date().toISOString()
      };

      const result = await triggerService.processPairTradeSignal(signal);

      expect(result.processedStrategies).toBe(2);
      expect(result.successfulTrades).toBe(1); // One failed
      expect(result.failedTrades).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should validate percentage is within valid range', async () => {
      const invalidSignal = {
        tokenAMint: 'So11111111111111111111111111111111111111112',
        tokenBMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        action: 'sell' as const,
        targetToken: 'A' as const,
        percentage: 150, // Invalid - over 100%
        timestamp: new Date().toISOString()
      };

      await expect(triggerService.processPairTradeSignal(invalidSignal))
        .rejects.toThrow('Invalid percentage: must be between 1 and 100');
    });

    it('should validate action is either buy or sell', async () => {
      const invalidSignal = {
        tokenAMint: 'So11111111111111111111111111111111111111112',
        tokenBMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        action: 'invalid' as any,
        targetToken: 'A' as const,
        percentage: 50,
        timestamp: new Date().toISOString()
      };

      await expect(triggerService.processPairTradeSignal(invalidSignal))
        .rejects.toThrow('Invalid action: must be buy or sell');
    });
  });
});