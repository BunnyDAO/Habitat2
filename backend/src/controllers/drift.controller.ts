import { Request, Response } from 'express';

/**
 * Controller for Drift Protocol related operations
 */
export class DriftController {
  /**
   * Get available Drift perpetual markets with their leverage limits
   */
  static async getMarkets(req: Request, res: Response): Promise<void> {
    try {
      console.log('[DriftController] Getting markets - using fallback data');
      
      // For now, return static market data to test the endpoint
      // TODO: Replace with actual Drift SDK integration
      const markets = [
        { 
          marketIndex: 0, 
          symbol: 'SOL-PERP', 
          baseAssetSymbol: 'SOL', 
          maxLeverage: 20,
          minOrderSize: 0.001,
          tickSize: 0.001,
          marginRatioInitial: 0.05,
          marginRatioMaintenance: 0.03
        },
        { 
          marketIndex: 1, 
          symbol: 'BTC-PERP', 
          baseAssetSymbol: 'BTC', 
          maxLeverage: 15,
          minOrderSize: 0.0001,
          tickSize: 0.01,
          marginRatioInitial: 0.067,
          marginRatioMaintenance: 0.04
        },
        { 
          marketIndex: 2, 
          symbol: 'ETH-PERP', 
          baseAssetSymbol: 'ETH', 
          maxLeverage: 18,
          minOrderSize: 0.001,
          tickSize: 0.01,
          marginRatioInitial: 0.056,
          marginRatioMaintenance: 0.035
        },
        { 
          marketIndex: 3, 
          symbol: 'AVAX-PERP', 
          baseAssetSymbol: 'AVAX', 
          maxLeverage: 12,
          minOrderSize: 0.01,
          tickSize: 0.001,
          marginRatioInitial: 0.083,
          marginRatioMaintenance: 0.05
        },
        { 
          marketIndex: 4, 
          symbol: 'BNB-PERP', 
          baseAssetSymbol: 'BNB', 
          maxLeverage: 10,
          minOrderSize: 0.001,
          tickSize: 0.01,
          marginRatioInitial: 0.1,
          marginRatioMaintenance: 0.06
        },
        { 
          marketIndex: 5, 
          symbol: 'MATIC-PERP', 
          baseAssetSymbol: 'MATIC', 
          maxLeverage: 8,
          minOrderSize: 1,
          tickSize: 0.0001,
          marginRatioInitial: 0.125,
          marginRatioMaintenance: 0.075
        }
      ];

      res.json({
        success: true,
        markets
      });
    } catch (error) {
      console.error('[DriftController] Error getting markets:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch Drift markets',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get specific market information by index
   */
  static async getMarket(req: Request, res: Response): Promise<void> {
    try {
      const { marketIndex } = req.params;
      const index = parseInt(marketIndex);

      if (isNaN(index) || index < 0) {
        res.status(400).json({
          success: false,
          error: 'Invalid market index'
        });
        return;
      }

      // Static market data - same as getMarkets
      const markets = [
        { marketIndex: 0, symbol: 'SOL-PERP', baseAssetSymbol: 'SOL', maxLeverage: 20 },
        { marketIndex: 1, symbol: 'BTC-PERP', baseAssetSymbol: 'BTC', maxLeverage: 15 },
        { marketIndex: 2, symbol: 'ETH-PERP', baseAssetSymbol: 'ETH', maxLeverage: 18 },
        { marketIndex: 3, symbol: 'AVAX-PERP', baseAssetSymbol: 'AVAX', maxLeverage: 12 },
        { marketIndex: 4, symbol: 'BNB-PERP', baseAssetSymbol: 'BNB', maxLeverage: 10 },
        { marketIndex: 5, symbol: 'MATIC-PERP', baseAssetSymbol: 'MATIC', maxLeverage: 8 }
      ];

      const market = markets.find(m => m.marketIndex === index);

      if (!market) {
        res.status(404).json({
          success: false,
          error: 'Market not found'
        });
        return;
      }

      res.json({
        success: true,
        market
      });
    } catch (error) {
      console.error('[DriftController] Error getting market:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch Drift market',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}