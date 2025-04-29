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
  }

  next();
}; 