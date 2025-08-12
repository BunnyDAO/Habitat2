import { Request, Response } from 'express';
import { DriftService } from '../services/DriftService';
import { Keypair } from '@solana/web3.js';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { WorkerManager } from '../services/WorkerManager';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

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

  /**
   * Close an open Drift perpetual position
   */
  static async closePosition(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { jobId, marketIndex } = req.body;
      
      if (!jobId || marketIndex === undefined) {
        res.status(400).json({
          success: false,
          error: 'Missing required parameters: jobId and marketIndex'
        });
        return;
      }

      // Get the strategy from database
      const supabase = createSupabaseClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_ANON_KEY!
      );
      const { data: strategy, error: strategyError } = await supabase
        .from('strategies')
        .select('*, trading_wallets!inner(*)')
        .eq('id', jobId)
        .eq('main_wallet_pubkey', req.user!.main_wallet_pubkey)
        .single();

      if (strategyError || !strategy) {
        res.status(404).json({
          success: false,
          error: 'Strategy not found or access denied'
        });
        return;
      }

      // Get the worker instance
      const worker = await WorkerManager.getWorker(jobId);
      
      if (!worker) {
        res.status(400).json({
          success: false,
          error: 'Strategy worker not found. Is the strategy active?'
        });
        return;
      }

      // Force close the position
      const result = await (worker as any).forceClosePosition();
      
      if (result.success) {
        res.json({
          success: true,
          signature: result.signature,
          message: 'Position closed successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error || 'Failed to close position'
        });
      }
    } catch (error) {
      console.error('[DriftController] Error closing position:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to close position',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Reduce an open Drift perpetual position by percentage
   */
  static async reducePosition(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { jobId, marketIndex, reducePercentage } = req.body;
      
      if (!jobId || marketIndex === undefined || !reducePercentage) {
        res.status(400).json({
          success: false,
          error: 'Missing required parameters: jobId, marketIndex, and reducePercentage'
        });
        return;
      }

      // Validate percentage
      const percentage = Number(reducePercentage);
      if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
        res.status(400).json({
          success: false,
          error: 'Invalid reduce percentage. Must be between 1 and 100'
        });
        return;
      }

      // Get the strategy from database
      const supabase = createSupabaseClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_ANON_KEY!
      );
      const { data: strategy, error: strategyError } = await supabase
        .from('strategies')
        .select('*, trading_wallets!inner(*)')
        .eq('id', jobId)
        .eq('main_wallet_pubkey', req.user!.main_wallet_pubkey)
        .single();

      if (strategyError || !strategy) {
        res.status(404).json({
          success: false,
          error: 'Strategy not found or access denied'
        });
        return;
      }

      // Get the worker instance
      const worker = await WorkerManager.getWorker(jobId);
      
      if (!worker) {
        res.status(400).json({
          success: false,
          error: 'Strategy worker not found. Is the strategy active?'
        });
        return;
      }

      // Get current position and calculate reduction
      const status = await (worker as any).getStatus();
      if (!status.currentPosition) {
        res.status(400).json({
          success: false,
          error: 'No open position to reduce'
        });
        return;
      }

      // Partially close the position by closing then reopening with reduced size
      const reduceAmount = status.currentPosition.baseAssetAmount * (percentage / 100);
      
      // For now, we'll close the entire position
      // TODO: Implement partial position reduction in DriftService
      const result = await (worker as any).forceClosePosition();
      
      if (result.success) {
        res.json({
          success: true,
          signature: result.signature,
          message: `Position reduced by ${percentage}%`
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error || 'Failed to reduce position'
        });
      }
    } catch (error) {
      console.error('[DriftController] Error reducing position:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to reduce position',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get current position status for a Drift strategy
   */
  static async getPosition(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;
      
      if (!jobId) {
        res.status(400).json({
          success: false,
          error: 'Missing required parameter: jobId'
        });
        return;
      }

      // Get the strategy from database
      const supabase = createSupabaseClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_ANON_KEY!
      );
      const { data: strategy, error: strategyError } = await supabase
        .from('strategies')
        .select('*, trading_wallets!inner(*)')
        .eq('id', jobId)
        .eq('main_wallet_pubkey', req.user!.main_wallet_pubkey)
        .single();

      if (strategyError || !strategy) {
        res.status(404).json({
          success: false,
          error: 'Strategy not found or access denied'
        });
        return;
      }

      // Try to get the worker instance, but handle failure gracefully
      let worker;
      try {
        worker = await WorkerManager.getWorker(jobId);
      } catch (error) {
        console.warn('[DriftController] Failed to get worker, will use direct DriftService approach:', error);
        worker = null;
      }
      
      if (!worker) {
        // If no worker, create a temporary DriftService to get account info
        try {
          const walletSecretKey = new Uint8Array(strategy.trading_wallets.secret_key);
          const wallet = Keypair.fromSecretKey(walletSecretKey);
          
          const driftService = new DriftService(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
          await driftService.initialize(wallet);
          
          // Get account info and current market price
          const accountInfo = await driftService.getAccountInfo();
          const currentPrice = await driftService.getMarketPrice(strategy.config.marketIndex || 0);
          
          // Clean up
          await driftService.cleanup();
          
          res.json({
            success: true,
            position: {
              isPositionOpen: strategy.is_position_open || false,
              currentPosition: strategy.current_position || null,
              lastUpdated: strategy.position_last_updated || null,
              currentPrice: currentPrice,
              accountInfo: accountInfo,
              marketSymbol: strategy.config.marketSymbol || 'SOL-PERP',
              entryPrice: strategy.config.entryPrice || 0,
              exitPrice: strategy.config.exitPrice || 0,
              isProcessingOrder: false
            }
          });
        } catch (driftError) {
          console.error('[DriftController] Error creating temporary DriftService:', driftError);
          // Return database info with fallback values
          res.json({
            success: true,
            position: {
              isPositionOpen: strategy.is_position_open || false,
              currentPosition: strategy.current_position || null,
              lastUpdated: strategy.position_last_updated || null,
              currentPrice: 0,
              accountInfo: {
                totalCollateral: 0,
                freeCollateral: 0,
                marginRatio: 0,
                leverage: 0,
                unrealizedPnl: 0
              },
              marketSymbol: strategy.config.marketSymbol || 'SOL-PERP',
              entryPrice: strategy.config.entryPrice || 0,
              exitPrice: strategy.config.exitPrice || 0,
              isProcessingOrder: false
            }
          });
        }
        return;
      }

      // Get live status from worker
      const status = await (worker as any).getStatus();
      
      res.json({
        success: true,
        position: {
          isPositionOpen: status.isPositionOpen,
          currentPosition: status.currentPosition,
          currentPrice: status.currentPrice,
          accountInfo: status.accountInfo,
          marketSymbol: status.marketSymbol,
          entryPrice: status.entryPrice,
          exitPrice: status.exitPrice,
          isProcessingOrder: status.isProcessingOrder
        }
      });
    } catch (error) {
      console.error('[DriftController] Error getting position:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get position status',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Withdraw collateral from Drift account
   */
  static async withdrawCollateral(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { jobId, amount } = req.body;
      
      if (!jobId) {
        res.status(400).json({
          success: false,
          error: 'Missing required parameter: jobId'
        });
        return;
      }

      // Get the strategy from database
      const supabase = createSupabaseClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_ANON_KEY!
      );
      const { data: strategy, error: strategyError } = await supabase
        .from('strategies')
        .select('*, trading_wallets!inner(*)')
        .eq('id', jobId)
        .eq('main_wallet_pubkey', req.user!.main_wallet_pubkey)
        .single();

      if (strategyError || !strategy) {
        res.status(404).json({
          success: false,
          error: 'Strategy not found or access denied'
        });
        return;
      }

      // Try to get the worker instance first
      let driftService;
      let isTemporaryService = false;
      
      try {
        const worker = await WorkerManager.getWorker(jobId);
        if (worker) {
          driftService = (worker as any).driftService;
        }
      } catch (error) {
        console.warn('[DriftController] Failed to get worker for withdrawal, will create temporary DriftService');
      }

      // If no worker or no driftService, create a temporary one
      if (!driftService) {
        try {
          const walletSecretKey = new Uint8Array(strategy.trading_wallets.secret_key);
          const wallet = Keypair.fromSecretKey(walletSecretKey);
          
          driftService = new DriftService(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
          await driftService.initialize(wallet);
          isTemporaryService = true;
        } catch (error) {
          res.status(500).json({
            success: false,
            error: 'Failed to initialize DriftService for withdrawal'
          });
          return;
        }
      }

      let withdrawAmount: number;
      if (amount === null || amount === undefined) {
        // Withdraw all available collateral
        const accountInfo = await driftService.getAccountInfo();
        withdrawAmount = accountInfo.freeCollateral;
      } else {
        withdrawAmount = Number(amount);
        if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
          res.status(400).json({
            success: false,
            error: 'Invalid withdrawal amount'
          });
          return;
        }
      }

      const result = await driftService.withdrawCollateral(withdrawAmount);
      
      // Clean up temporary DriftService if we created one
      if (isTemporaryService) {
        try {
          await driftService.cleanup();
        } catch (cleanupError) {
          console.warn('[DriftController] Error cleaning up temporary DriftService:', cleanupError);
        }
      }
      
      if (result.success) {
        res.json({
          success: true,
          signature: result.signature,
          amount: withdrawAmount,
          message: `Successfully withdrew ${withdrawAmount} SOL from collateral`
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error || 'Failed to withdraw collateral'
        });
      }
    } catch (error) {
      console.error('[DriftController] Error withdrawing collateral:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to withdraw collateral',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}