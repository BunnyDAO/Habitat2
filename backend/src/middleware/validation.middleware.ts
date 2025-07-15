import { Request, Response, NextFunction } from 'express';
import { JobType } from '../types/jobs';

export const validateStrategyRequest = (
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
  console.log('Checking strategy type:', {
    received: strategy_type,
    validTypes,
    isIncluded: validTypes.includes(strategy_type)
  });

  if (!validTypes.includes(strategy_type)) {
    console.log('Invalid strategy type:', {
      received: strategy_type,
      validTypes
    });
    return res.status(400).json({
      error: 'Invalid strategy type',
      validTypes
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
      const requiredFields = ['tokenAMint', 'tokenBMint', 'tokenASymbol', 'tokenBSymbol', 'allocationPercentage', 'currentToken'];
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
      
      // Validate current token
      if (config.currentToken !== 'A' && config.currentToken !== 'B') {
        console.log('Invalid pair trade config - invalid current token:', config.currentToken);
        return res.status(400).json({
          error: 'Invalid pair trade configuration',
          details: 'Current token must be either "A" or "B"'
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
  }

  next();
}; 