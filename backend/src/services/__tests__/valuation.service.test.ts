import { ValuationService } from '../valuation.service';

describe('ValuationService', () => {
  let valuationService: ValuationService;

  beforeEach(() => {
    valuationService = new ValuationService();
  });

  describe('getUndervaluedToken', () => {
    it('should return tokenA when tokenA is undervalued', async () => {
      // Mock external API response
      const mockApiResponse = {
        recommendation: 'A',
        reasoning: 'Token A is 15% undervalued compared to Token B',
        confidence: 0.85
      };

      // Mock the external API call
      jest.spyOn(valuationService as any, 'callValuationAPI').mockResolvedValue(mockApiResponse);

      const result = await valuationService.getUndervaluedToken('SOL_MINT', 'USDC_MINT');

      expect(result.recommendedToken).toBe('A');
      expect(result.reasoning).toBe('Token A is 15% undervalued compared to Token B');
      expect(result.confidence).toBe(0.85);
    });

    it('should return tokenB when tokenB is undervalued', async () => {
      const mockApiResponse = {
        recommendation: 'B',
        reasoning: 'Token B is 12% undervalued compared to Token A',
        confidence: 0.78
      };

      jest.spyOn(valuationService as any, 'callValuationAPI').mockResolvedValue(mockApiResponse);

      const result = await valuationService.getUndervaluedToken('SOL_MINT', 'USDC_MINT');

      expect(result.recommendedToken).toBe('B');
      expect(result.reasoning).toBe('Token B is 12% undervalued compared to Token A');
    });

    it('should handle API timeout gracefully', async () => {
      jest.spyOn(valuationService as any, 'callValuationAPI').mockRejectedValue(new Error('Request timeout'));

      await expect(valuationService.getUndervaluedToken('SOL_MINT', 'USDC_MINT'))
        .rejects.toThrow('Valuation service timeout');
    });

    it('should throw error when valuation endpoint is unreachable', async () => {
      jest.spyOn(valuationService as any, 'callValuationAPI').mockRejectedValue(new Error('Network error'));

      await expect(valuationService.getUndervaluedToken('SOL_MINT', 'USDC_MINT'))
        .rejects.toThrow('Valuation service unavailable');
    });

    it('should validate token mint addresses before calling endpoint', async () => {
      await expect(valuationService.getUndervaluedToken('', 'USDC_MINT'))
        .rejects.toThrow('Invalid token mint addresses');

      await expect(valuationService.getUndervaluedToken('SOL_MINT', ''))
        .rejects.toThrow('Invalid token mint addresses');

      await expect(valuationService.getUndervaluedToken('invalid', 'USDC_MINT'))
        .rejects.toThrow('Invalid token mint addresses');
    });

    it('should cache valuation results for 5 minutes', async () => {
      const mockApiResponse = {
        recommendation: 'A',
        reasoning: 'Token A is undervalued',
        confidence: 0.85
      };

      const apiSpy = jest.spyOn(valuationService as any, 'callValuationAPI').mockResolvedValue(mockApiResponse);

      // First call
      await valuationService.getUndervaluedToken('SOL_MINT', 'USDC_MINT');
      
      // Second call within 5 minutes - should use cache
      await valuationService.getUndervaluedToken('SOL_MINT', 'USDC_MINT');

      expect(apiSpy).toHaveBeenCalledTimes(1);
    });
  });
});