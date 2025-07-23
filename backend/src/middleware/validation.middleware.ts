import { Request, Response, NextFunction } from 'express';
import { JobType } from '../types/jobs';
import { DriftService } from '../services/DriftService';
import { Keypair } from '@solana/web3.js';

export const validateStrategyRequest = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { trading_wallet_id, strategy_type, config } = req.body;

  console.log('Validating strategy request:', {
    strategy_type,
    validTypes: Object.values(JobType),
    config
  });

  // Check required fields
  if (!trading_wallet_id || !strategy_type || !config) {
    console.log('Missing required fields:', {
      trading_wallet_id,
      strategy_type,
      config
    });
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['trading_wallet_id', 'strategy_type', 'config']
    });
  }

  // Validate strategy type
  const validTypes = Object.values(JobType);
  // Ensure drift-perp is included in case of enum loading issues
  const allValidTypes = [...validTypes, 'drift-perp'];
  console.log('Checking strategy type:', {
    received: strategy_type,
    validTypes: allValidTypes,
    isIncluded: allValidTypes.includes(strategy_type)
  });

  if (!allValidTypes.includes(strategy_type)) {
    console.log('Invalid strategy type:', {
      received: strategy_type,
      validTypes: allValidTypes
    });
    return res.status(400).json({
      error: 'Invalid strategy type',
      validTypes: allValidTypes
    });
  }

  // Validate config based on strategy type
  switch (strategy_type) {
    case 'wallet-monitor':
      console.log('Validating wallet monitor config:', config);
      if (!config.walletAddress || !config.percentage) {
        console.log('Invalid wallet monitor config:', {
          walletAddress: config.walletAddress,
          percentage: config.percentage
        });
        return res.status(400).json({
          error: 'Invalid wallet monitor configuration',
          required: ['walletAddress', 'percentage']
        });
      }
      break;

    case 'price-monitor':
      if (!config.targetPrice || !config.direction || !config.percentageToSell) {
        return res.status(400).json({
          error: 'Invalid price monitor configuration',
          required: ['targetPrice', 'direction', 'percentageToSell']
        });
      }
      break;

    case 'vault':
      if (!config.vaultPercentage) {
        return res.status(400).json({
          error: 'Invalid vault configuration',
          required: ['vaultPercentage']
        });
      }
      break;

    case 'levels':
      if (!Array.isArray(config.levels) || config.levels.length === 0) {
        return res.status(400).json({
          error: 'Invalid levels configuration',
          required: ['levels (array)']
        });
      }
      break;

    case 'pair-trade':
      console.log('Validating pair trade config:', config);
      const requiredFields = ['tokenAMint', 'tokenBMint', 'tokenASymbol', 'tokenBSymbol', 'allocationPercentage'];
      const missingFields = requiredFields.filter(field => !config[field]);
      
      if (missingFields.length > 0) {
        console.log('Invalid pair trade config - missing fields:', missingFields);
        return res.status(400).json({
          error: 'Invalid pair trade configuration',
          required: requiredFields,
          missing: missingFields
        });
      }
      
      // Validate token addresses are different
      if (config.tokenAMint === config.tokenBMint) {
        console.log('Invalid pair trade config - same token addresses');
        return res.status(400).json({
          error: 'Invalid pair trade configuration',
          details: 'Token A and Token B must be different'
        });
      }
      
      // Validate allocation percentage
      if (config.allocationPercentage < 1 || config.allocationPercentage > 100) {
        console.log('Invalid pair trade config - allocation percentage out of range:', config.allocationPercentage);
        return res.status(400).json({
          error: 'Invalid pair trade configuration',
          details: 'Allocation percentage must be between 1 and 100'
        });
      }
      
      
      // Validate max slippage if provided
      if (config.maxSlippage && (config.maxSlippage < 0.1 || config.maxSlippage > 10)) {
        console.log('Invalid pair trade config - max slippage out of range:', config.maxSlippage);
        return res.status(400).json({
          error: 'Invalid pair trade configuration',
          details: 'Max slippage must be between 0.1% and 10%'
        });
      }
      
      break;

    case 'drift-perp':
      console.log('Validating drift perp config:', config);
      const requiredDriftFields = ['marketSymbol', 'marketIndex', 'direction', 'allocationPercentage', 'entryPrice', 'exitPrice', 'leverage'];
      const missingDriftFields = requiredDriftFields.filter(field => config[field] === undefined || config[field] === null);
      
      if (missingDriftFields.length > 0) {
        console.log('Invalid drift perp config - missing fields:', missingDriftFields);
        return res.status(400).json({
          error: 'Invalid drift perp configuration',
          required: requiredDriftFields,
          missing: missingDriftFields
        });
      }
      
      // Validate direction
      if (!['long', 'short'].includes(config.direction)) {
        console.log('Invalid drift perp config - invalid direction:', config.direction);
        return res.status(400).json({
          error: 'Invalid drift perp configuration',
          details: 'Direction must be either "long" or "short"'
        });
      }
      
      // Validate allocation percentage
      if (config.allocationPercentage < 1 || config.allocationPercentage > 100) {
        console.log('Invalid drift perp config - allocation percentage out of range:', config.allocationPercentage);
        return res.status(400).json({
          error: 'Invalid drift perp configuration',
          details: 'Allocation percentage must be between 1 and 100'
        });
      }
      
      // Validate leverage using static market data (same as frontend fallback)
      const staticMarkets = [
        { marketIndex: 0, symbol: 'SOL-PERP', maxLeverage: 20 },
        { marketIndex: 1, symbol: 'BTC-PERP', maxLeverage: 15 },
        { marketIndex: 2, symbol: 'ETH-PERP', maxLeverage: 18 },
        { marketIndex: 3, symbol: 'AVAX-PERP', maxLeverage: 12 },
        { marketIndex: 4, symbol: 'BNB-PERP', maxLeverage: 10 },
        { marketIndex: 5, symbol: 'MATIC-PERP', maxLeverage: 8 }
      ];
      
      const market = staticMarkets.find(m => m.marketIndex === config.marketIndex);
      
      if (!market) {
        console.log('Invalid drift perp config - market not found:', config.marketIndex);
        return res.status(400).json({
          error: 'Invalid drift perp configuration',
          details: `Market with index ${config.marketIndex} not found`
        });
      }
      
      const maxLeverage = market.maxLeverage;
      if (config.leverage < 1 || config.leverage > maxLeverage) {
        console.log('Invalid drift perp config - leverage out of range:', { 
          leverage: config.leverage, 
          maxLeverage, 
          marketIndex: config.marketIndex 
        });
        return res.status(400).json({
          error: 'Invalid drift perp configuration',
          details: `Leverage must be between 1x and ${maxLeverage}x for ${market.symbol}`
        });
      }
      
      console.log(`Drift perp config validated - leverage ${config.leverage}x is valid for ${market.symbol} (max: ${maxLeverage}x)`);
      
      // Validate prices
      if (config.entryPrice <= 0 || config.exitPrice <= 0) {
        console.log('Invalid drift perp config - invalid prices:', { entryPrice: config.entryPrice, exitPrice: config.exitPrice });
        return res.status(400).json({
          error: 'Invalid drift perp configuration',
          details: 'Entry and exit prices must be greater than 0'
        });
      }
      
      // Validate market index
      if (config.marketIndex < 0 || !Number.isInteger(config.marketIndex)) {
        console.log('Invalid drift perp config - invalid market index:', config.marketIndex);
        return res.status(400).json({
          error: 'Invalid drift perp configuration',
          details: 'Market index must be a non-negative integer'
        });
      }
      
      break;
  }

  next();
}; 