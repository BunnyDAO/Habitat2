import { Request, Response, NextFunction } from 'express';
import { JobType } from '../types/jobs';

export const validateStrategyRequest = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { trading_wallet_id, strategy_type, config } = req.body;

  // Check required fields
  if (!trading_wallet_id || !strategy_type || !config) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['trading_wallet_id', 'strategy_type', 'config']
    });
  }

  // Validate strategy type
  if (!Object.values(JobType).includes(strategy_type)) {
    return res.status(400).json({
      error: 'Invalid strategy type',
      validTypes: Object.values(JobType)
    });
  }

  // Validate config based on strategy type
  switch (strategy_type) {
    case JobType.WALLET_MONITOR:
      if (!config.walletAddress || !config.percentage) {
        return res.status(400).json({
          error: 'Invalid wallet monitor configuration',
          required: ['walletAddress', 'percentage']
        });
      }
      break;

    case JobType.PRICE_MONITOR:
      if (!config.targetPrice || !config.direction || !config.percentageToSell) {
        return res.status(400).json({
          error: 'Invalid price monitor configuration',
          required: ['targetPrice', 'direction', 'percentageToSell']
        });
      }
      break;

    case JobType.VAULT:
      if (!config.vaultPercentage) {
        return res.status(400).json({
          error: 'Invalid vault configuration',
          required: ['vaultPercentage']
        });
      }
      break;

    case JobType.LEVELS:
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