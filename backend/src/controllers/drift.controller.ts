import { Request, Response } from 'express';
import { DriftService } from '../services/DriftService';
import { Connection, Keypair } from '@solana/web3.js';

/**
 * Controller for Drift Protocol related operations
 */
export class DriftController {
  private static driftService: DriftService | null = null;

  /**
   * Get available Drift perpetual markets with their leverage limits
   */
  static async getMarkets(req: Request, res: Response): Promise<void> {
    try {
      // Initialize DriftService if not already done
      if (!DriftController.driftService) {
        const endpoint = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
        DriftController.driftService = new DriftService(endpoint);
      }

      // Use a temporary keypair for market data queries (no funds needed)
      const tempKeypair = Keypair.generate();
      await DriftController.driftService.initialize(tempKeypair);

      const markets = await DriftController.driftService.getAvailableMarkets();

      res.json({
        success: true,
        markets: markets.map(market => ({
          marketIndex: market.marketIndex,
          symbol: market.symbol,
          baseAssetSymbol: market.baseAssetSymbol,
          maxLeverage: market.maxLeverage,
          minOrderSize: market.minOrderSize,
          tickSize: market.tickSize,
          marginRatioInitial: market.marginRatioInitial,
          marginRatioMaintenance: market.marginRatioMaintenance
        }))
      });

      // Clean up
      await DriftController.driftService.cleanup();
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

      // Initialize DriftService if not already done
      if (!DriftController.driftService) {
        const endpoint = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
        DriftController.driftService = new DriftService(endpoint);
      }

      // Use a temporary keypair for market data queries (no funds needed)
      const tempKeypair = Keypair.generate();
      await DriftController.driftService.initialize(tempKeypair);

      const markets = await DriftController.driftService.getAvailableMarkets();
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
        market: {
          marketIndex: market.marketIndex,
          symbol: market.symbol,
          baseAssetSymbol: market.baseAssetSymbol,
          maxLeverage: market.maxLeverage,
          minOrderSize: market.minOrderSize,
          tickSize: market.tickSize,
          marginRatioInitial: market.marginRatioInitial,
          marginRatioMaintenance: market.marginRatioMaintenance
        }
      });

      // Clean up
      await DriftController.driftService.cleanup();
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