import { Router, Request, Response } from 'express';
import { StrategyPublishingService } from '../services/strategy-publishing.service';
import { authMiddleware } from '../middleware/auth.middleware';
import {
  PublishStrategyRequest,
  UpdatePublishedStrategyRequest,
  PublishStrategyResponse,
  UnpublishStrategyResponse
} from '../types/strategy-publishing';

const router = Router();
const strategyPublishingService = new StrategyPublishingService();

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @route POST /api/strategies/:id/publish
 * @desc Publish a strategy to the marketplace
 * @access Private
 */
router.post('/:id/publish', async (req: Request, res: Response) => {
  try {
    const strategyId = parseInt(req.params.id);
    const publishData: PublishStrategyRequest = req.body;
    const publisherWallet = req.user?.main_wallet_pubkey;

    if (!publisherWallet) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Validate request data
    const errors = validatePublishRequest(publishData);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    // Validate strategy for publishing
    const validation = await strategyPublishingService.validateForPublishing(strategyId);
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: 'Strategy validation failed',
        details: validation.errors,
        warnings: validation.warnings
      });
    }

    // Publish the strategy
    const publishedStrategy = await strategyPublishingService.publishStrategy(
      strategyId,
      publishData,
      publisherWallet
    );

    const response: PublishStrategyResponse = {
      publishedStrategyId: publishedStrategy.id,
      status: 'published',
      message: 'Strategy published successfully'
    };

    res.status(201).json(response);

  } catch (error) {
    console.error('Error publishing strategy:', error);
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to publish strategy' });
    }
  }
});

/**
 * @route PUT /api/strategies/published/:id
 * @desc Update a published strategy
 * @access Private
 */
router.put('/published/:id', async (req: Request, res: Response) => {
  try {
    const publishedStrategyId = parseInt(req.params.id);
    const updateData: UpdatePublishedStrategyRequest = req.body;
    const publisherWallet = req.user?.main_wallet_pubkey;

    if (!publisherWallet) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const updatedStrategy = await strategyPublishingService.updatePublishedStrategy(
      publishedStrategyId,
      updateData,
      publisherWallet
    );

    res.json(updatedStrategy);

  } catch (error) {
    console.error('Error updating published strategy:', error);
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to update published strategy' });
    }
  }
});

/**
 * @route DELETE /api/strategies/published/:id
 * @desc Unpublish a strategy
 * @access Private
 */
router.delete('/published/:id', async (req: Request, res: Response) => {
  try {
    const publishedStrategyId = parseInt(req.params.id);
    const publisherWallet = req.user?.main_wallet_pubkey;

    if (!publisherWallet) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    await strategyPublishingService.unpublishStrategy(publishedStrategyId, publisherWallet);

    const response: UnpublishStrategyResponse = {
      success: true,
      message: 'Strategy unpublished successfully'
    };

    res.json(response);

  } catch (error) {
    console.error('Error unpublishing strategy:', error);
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to unpublish strategy' });
    }
  }
});

/**
 * @route GET /api/strategies/unpublished
 * @desc Get user's unpublished strategies (available for publishing)
 * @access Private
 */
router.get('/unpublished', async (req: Request, res: Response) => {
  try {
    const publisherWallet = req.user?.main_wallet_pubkey;

    if (!publisherWallet) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const unpublishedStrategies = await strategyPublishingService.getUnpublishedStrategiesByUser(publisherWallet);
    res.json(unpublishedStrategies);

  } catch (error) {
    console.error('Error fetching unpublished strategies:', error);
    res.status(500).json({ error: 'Failed to fetch unpublished strategies' });
  }
});

/**
 * @route GET /api/strategies/published
 * @desc Get user's published strategies
 * @access Private
 */
router.get('/published', async (req: Request, res: Response) => {
  try {
    const publisherWallet = req.user?.main_wallet_pubkey;

    if (!publisherWallet) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const publishedStrategies = await strategyPublishingService.getPublishedStrategiesByUser(publisherWallet);
    res.json(publishedStrategies);

  } catch (error) {
    console.error('Error fetching published strategies:', error);
    res.status(500).json({ error: 'Failed to fetch published strategies' });
  }
});

/**
 * @route GET /api/strategies/published/:id
 * @desc Get published strategy details
 * @access Private
 */
router.get('/published/:id', async (req: Request, res: Response) => {
  try {
    const publishedStrategyId = parseInt(req.params.id);

    const publishedStrategy = await strategyPublishingService.getPublishedStrategy(publishedStrategyId);
    
    if (!publishedStrategy) {
      return res.status(404).json({ error: 'Published strategy not found' });
    }

    res.json(publishedStrategy);

  } catch (error) {
    console.error('Error fetching published strategy:', error);
    res.status(500).json({ error: 'Failed to fetch published strategy' });
  }
});

/**
 * @route GET /api/strategies/published/:id/requirements
 * @desc Get wallet requirements for a published strategy
 * @access Private
 */
router.get('/published/:id/requirements', async (req: Request, res: Response) => {
  try {
    const publishedStrategyId = parseInt(req.params.id);

    const requirements = await strategyPublishingService.getWalletRequirements(publishedStrategyId);
    res.json(requirements);

  } catch (error) {
    console.error('Error fetching wallet requirements:', error);
    res.status(500).json({ error: 'Failed to fetch wallet requirements' });
  }
});

/**
 * @route POST /api/strategies/:id/validate-publishing
 * @desc Validate if a strategy can be published
 * @access Private
 */
router.post('/:id/validate-publishing', async (req: Request, res: Response) => {
  try {
    const strategyId = parseInt(req.params.id);

    const validation = await strategyPublishingService.validateForPublishing(strategyId);
    res.json(validation);

  } catch (error) {
    console.error('Error validating strategy for publishing:', error);
    res.status(500).json({ error: 'Failed to validate strategy' });
  }
});

/**
 * @route GET /api/strategies/:id/performance-metrics
 * @desc Get performance metrics for a strategy
 * @access Private
 */
router.get('/:id/performance-metrics', async (req: Request, res: Response) => {
  try {
    const strategyId = parseInt(req.params.id);

    const metrics = await strategyPublishingService.calculatePerformanceMetrics(strategyId);
    res.json(metrics);

  } catch (error) {
    console.error('Error calculating performance metrics:', error);
    res.status(500).json({ error: 'Failed to calculate performance metrics' });
  }
});

/**
 * @route GET /api/strategies/:id/performance-history
 * @desc Get performance history for a strategy
 * @access Private
 */
router.get('/:id/performance-history', async (req: Request, res: Response) => {
  try {
    const strategyId = parseInt(req.params.id);
    const { startDate, endDate } = req.query;

    const history = await strategyPublishingService.getPerformanceHistory(
      strategyId,
      startDate as string,
      endDate as string
    );

    res.json(history);

  } catch (error) {
    console.error('Error fetching performance history:', error);
    res.status(500).json({ error: 'Failed to fetch performance history' });
  }
});

/**
 * @route POST /api/strategies/:id/record-performance
 * @desc Record daily performance for a strategy
 * @access Private
 */
router.post('/:id/record-performance', async (req: Request, res: Response) => {
  try {
    const strategyId = parseInt(req.params.id);
    const performanceData = req.body;

    const record = await strategyPublishingService.recordPerformanceHistory(strategyId, performanceData);
    res.status(201).json(record);

  } catch (error) {
    console.error('Error recording performance:', error);
    res.status(500).json({ error: 'Failed to record performance' });
  }
});

// Validation helper function
function validatePublishRequest(data: PublishStrategyRequest): string[] {
  const errors: string[] = [];

  if (!data.title || data.title.trim().length === 0) {
    errors.push('Title is required');
  }

  if (data.title && data.title.length > 255) {
    errors.push('Title must be less than 255 characters');
  }

  if (data.description && data.description.length > 5000) {
    errors.push('Description must be less than 5000 characters');
  }

  if (!data.requiredWallets || data.requiredWallets < 1 || data.requiredWallets > 3) {
    errors.push('Required wallets must be between 1 and 3');
  }

  if (data.minBalanceSol < 0) {
    errors.push('Minimum balance cannot be negative');
  }

  if (!data.isFree && (!data.priceSol || data.priceSol <= 0)) {
    errors.push('Price must be greater than 0 for paid strategies');
  }

  if (data.priceSol && data.priceSol < 0) {
    errors.push('Price cannot be negative');
  }

  if (!data.walletRequirements || data.walletRequirements.length === 0) {
    errors.push('Wallet requirements are required');
  }

  if (data.walletRequirements && data.walletRequirements.length !== data.requiredWallets) {
    errors.push('Number of wallet requirements must match required wallets count');
  }

  // Validate wallet requirements
  if (data.walletRequirements) {
    const positions = new Set();
    
    for (const req of data.walletRequirements) {
      if (req.position < 1 || req.position > 3) {
        errors.push('Wallet position must be between 1 and 3');
      }
      
      if (positions.has(req.position)) {
        errors.push('Duplicate wallet positions are not allowed');
      }
      positions.add(req.position);
      
      if (!req.role || req.role.trim().length === 0) {
        errors.push('Wallet role is required');
      }
      
      if (req.minBalance < 0) {
        errors.push('Wallet minimum balance cannot be negative');
      }
    }
  }

  if (data.tags && data.tags.length > 20) {
    errors.push('Maximum 20 tags allowed');
  }

  if (data.tags) {
    for (const tag of data.tags) {
      if (tag.length > 50) {
        errors.push('Tags must be less than 50 characters');
      }
    }
  }

  return errors;
}

export default router;